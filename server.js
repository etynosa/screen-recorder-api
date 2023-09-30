const express = require('express');
const multer = require('multer');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const fluentFfmpeg = require('fluent-ffmpeg');
const { body, validationResult } = require('express-validator');
const { env } = require('process');

const app = express();
const port = 3000;

// Create an SQLite database
const db = new sqlite3.Database(':memory:');

// Initialize the database schema
db.serialize(() => {
  db.run('CREATE TABLE recordings (id TEXT PRIMARY KEY, url TEXT, metadata TEXT)');
});

// Create an array to store received blobs
const blobArray = [];

// Set up Multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Middleware for input validation, including file size check
const validateInput = [
  body('file')
    .custom((value, { req }) => {
      // Check if the uploaded file size is less than or equal to 25MB
      if (req.file && req.file.size <= 25 * 1024 * 1024) {
        return true;
      }
      throw new Error('File size should be a maximum of 25MB');
    })
    .notEmpty(),
  body('id').notEmpty().isString(),
  body('blob').notEmpty().isBase64(),
];

// Function to generate a unique ID
function generateUniqueId() {
  return Math.random().toString(36).substring(2, 15);
}

// Function to transcribe audio using OpenAI API
async function transcribeAudio(blobData) {
  try {
    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', {
      audio: blobData,
      model: "whisper-1"
    }, {
      headers: {
        'Authorization': process.env.APIKEY, 
      },
    });

    // Return the transcription from the response
    return response.data.transcription;
  } catch (error) {
    console.error('Error transcribing audio:', error);
    throw error;
  }
}

// Function to process a recording
async function processRecording(session, callback) {
  const outputFilePath = `./recordings/${session.id}.mp4`;

  // Combine and convert blobs to an MP4 file using FFmpeg
  const ffmpegCommand = fluentFfmpeg()
    .input('pipe:0')
    .inputFormat('s16le')
    .audioCodec('aac')
    .videoCodec('libx264')
    .on('end', () => {
      const metadata = { duration: 60 }; // Sample metadata, replace with actual metadata
      callback(null, outputFilePath, metadata);
    })
    .on('error', (err) => {
      callback(err);
    });

  session.data.forEach((blob) => {
    ffmpegCommand.input('pipe:3');
  });

  ffmpegCommand.output(outputFilePath, { end: true }).pipe(fs.createWriteStream(outputFilePath));
}

// Route for starting the recording
app.post('/start', upload.single('file'), validateInput, (req, res) => {
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
app.post('/sendBlob/:id', validateInput, async (req, res) => {
  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const fileId = req.params.id;
  const blobData = req.body.blob;

  // Find the corresponding recording session
  const session = blobArray.find((session) => session.id === fileId);
  if (!session) {
    return res.status(404).json({ error: 'Recording session not found' });
  }

  // Add the received blob to the session data
  session.data.push(Buffer.from(blobData, 'base64'));

  // Check if the session has 3 blobs and trigger processing
  if (session.data.length === 3) {
    try {
        processRecording(session)
      const transcription = await transcribeAudio(Buffer.concat(session.data));
      const metadata = { duration: 60, transcription }; // Include transcription in metadata

      // Save recording metadata to the database
      db.serialize(() => {
        const stmt = db.prepare('INSERT INTO recordings VALUES (?, ?, ?)');
        stmt.run(session.id, null, JSON.stringify(metadata)); // Note: Set URL to null for now
        stmt.finalize();
      });

      // Clear the session data
      session.data = [];

      res.json({ message: 'Recording processed successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Error processing recording' });
    }
  } else {
    res.json({ message: 'Blob received' });
  }
});

// Route for stopping the recording
app.post('/stop/:id', validateInput, (req, res) => {
  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const fileId = req.params.id;
  const lastBlob = req.body.blob;

  // Find the corresponding recording session
  const session = blobArray.find((session) => session.id === fileId);
  if (!session) {
    return res.status(404).json({ error: 'Recording session not found' });
  }

  // Add the last blob to the session data
  session.data.push(Buffer.from(lastBlob, 'base64'));

  res.json({ message: 'Recording updated' });
});

// Route for retrieving processed video data in chunks
app.get('/recordings/:id', (req, res) => {
  const fileId = req.params.id;

  // Retrieve recording data from the database
  db.get('SELECT * FROM recordings WHERE id = ?', fileId, async (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Error retrieving recording data' });
    }

    if (!row) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    const videoFilePath = `./recordings/${fileId}.mp4`;

    // Check if the video file exists
    if (!fs.existsSync(videoFilePath)) {
      return res.status(404).json({ error: 'Video file not found' });
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

    fileStream.on('error', (error) => {
      console.error('Error reading video file:', error);
      res.status(500).json({ error: 'Error reading video file' });
    });

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename=${fileId}.mp4`);
  });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
