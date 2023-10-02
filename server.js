const express = require("express");
const multer = require("multer");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const { validationResult } = require("express-validator");
const bodyParser = require("body-parser");
const axios = require("axios");
const { writeFile } = require("fs/promises");

const app = express();
const port = 3000;
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json({ limit: "50MB", type: "application/json" }));

// Create an SQLite database
const db = new sqlite3.Database("recordings.db");

db.serialize(() => {
  db.run(
    "CREATE TABLE IF NOT EXISTS recordings (id TEXT PRIMARY KEY, url TEXT, metadata TEXT, transcription TEXT)"
  );
});

// Create an array to store received blobs
const blobArray = [];
const maxChunks = 3;
const API_KEY = process.env.APIKEY;

// Set up Multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Function to generate a unique ID
function generateUniqueId() {
  return Math.random().toString(36).substring(2, 15);
}

async function transcribeAudio(AUDIO_FILE_PATH) {
  try {
    const audioData = fs.readFileSync(AUDIO_FILE_PATH);

    const response = await axios.post(
      "https://api.deepgram.com/v1/listen",
      audioData,
      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "video/webm", // Adjust content type based on your audio format
        },
      }
    );

    if (response.status === 200) {
      const transcription =
        response.data && response.data.results
          ? response.data.results[0].alternatives[0].transcript
          : "No transcription available";
      console.log("Transcription:", transcription);
    } else {
      console.error("Transcription request failed:", response.statusText);
    }
  } catch (error) {
    console.error("Error:", error.message);
  }
}

// Route for starting the recording
app.post("/start", upload.single("videoChunk"), (req, res) => {
  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  // Store the uploaded file
  const fileId = generateUniqueId();
  blobArray.push({ id: fileId, data: [] });
  res.json({ id: fileId });
});

// Route for sending blobs intermittently
app.post("/sendBlob/:id", async (req, res) => {
  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const fileId = req.params.id;
  const { binary } = req.body;

  const blobData = Buffer.from(new Uint8Array(binary));

  console.log("lastblob", blobData);
  // Find the corresponding recording session
  const session = blobArray.find((session) => session.id === fileId);
  if (!session) {
    return res.status(404).json({ error: "Recording session not found" });
  }

  // Add the received blob to the session data
  session.data.push(blobData);
  console.log("lastblob", session.data);
  // Check if the session has reached maxChunks and trigger processing
  if (session.data.length >= maxChunks) {
    try {
      const outputFilePath = `./recordings/${session.id}.webm`;
      const metadata = { duration: 60 };

      fs.writeFile(outputFilePath, Buffer.concat(session.data), async (err) => {
        console.log(Buffer.concat(session.data));
        if (err) {
          res.status(500).json({ error: "Error saving video" });
        } else {
          // Save recording metadata to the database
          db.serialize(() => {
            const stmt = db.prepare(
              "INSERT INTO recordings VALUES (?, ?, ?, ?)"
            );
            stmt.run(
              session.id,
              outputFilePath,
              JSON.stringify({ ...metadata }),
              ""
            );
            stmt.finalize();
          });

          const transcription = await transcribeAudio(outputFilePath);
          db.serialize(() => {
            const stmt = db.prepare(
              "UPDATE recordings SET transcription = ? WHERE id = ?"
            );
            stmt.run(transcription, session.id);
            stmt.finalize();
          });
          res.json({ message: "Recording processed and saved successfully" });
        }
      });
    } catch (error) {
      res.status(500).json({ error: "Error processing recording" });
    } finally {
      // Clear the session data
      session.data = [];
    }
  } else {
    res.json({ message: "Blob received" });
  }
});

app.post("/stop/:id", upload.single("videoChunk"), async (req, res) => {
  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const fileId = req.params.id;
  const { binary } = req.body;

  const lastBlob = Buffer.from(new Uint8Array(binary));

  console.log("lastblob", lastBlob);
  // Find the corresponding recording session
  const session = blobArray.find((session) => session.id === fileId);
  if (!session) {
    return res.status(404).json({ error: "Recording session not found" });
  }

  // Add the last blob to the session data
  session.data.push(lastBlob);

  try {
    const outputFilePath = `./recordings/${session.id}.webm`;
    const metadata = { duration: 60 };

    const videoBuffer = Buffer.concat(session.data);

    // Send the video as the response
    fs.writeFile(outputFilePath, videoBuffer, async (err) => {
      if (err) {
        return res.status(500).json({ error: "Error saving video" });
      }

      // let w = fs.createWriteStream(outputFilePath)
      // w.write(videoBuffer)
      db.serialize(() => {
        const stmt = db.prepare("INSERT INTO recordings VALUES (?, ?, ?, ?)");
        stmt.run(
          session.id,
          outputFilePath,
          JSON.stringify({ ...metadata }),
          ""
        );
        stmt.finalize();
      });

      const transcription = await transcribeAudio(outputFilePath);
      db.serialize(() => {
        const stmt = db.prepare(
          "UPDATE recordings SET transcription = ? WHERE id = ?"
        );
        stmt.run(transcription, session.id);
        stmt.finalize();
      });

      res.send({ message: "Recording Updated" });
    });
  } catch (error) {
    res.status(500).json({ error: error });
  } finally {
    // Clear the session data
    session.data = [];
  }
});

// Route for retrieving processed video data in chunks
app.get("/recordings/:id", (req, res) => {
  const fileId = req.params.id;

  // Retrieve recording data from the database
  db.get("SELECT * FROM recordings WHERE id = ?", fileId, async (err, row) => {
    if (err) {
      return res.status(500).json({ error: "Error retrieving recording data" });
    }

    if (!row) {
      return res.status(404).json({ error: "Recording not found" });
    }

    const videoFilePath = row.url;
    const transcription = row.transcription;
    console.log(transcription);
    // Check if the video file exists
    if (!fs.existsSync(videoFilePath)) {
      return res.status(404).json({ error: "Video file not found" });
    }

    // Read the video file in chunks and send as byte data
    const chunkSize = 1024 * 1024; // 1MB

    const fileStream = fs.createReadStream(videoFilePath, { highWaterMark: chunkSize });

    fileStream.on('data', (chunk) => {
      res.write(chunk);
    });

    fileStream.on('end', () => {
      res.end();
    });

    fileStream.on("error", (error) => {
      console.error("Error reading video file:", error);
      res.status(500).json({ error: "Error reading video file" });
    });

    res.setHeader("Content-Type", "video/webm");
    res.setHeader("Content-Disposition", `attachment; filename=${fileId}.webm`);
    res.json({ transcription });
  });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
