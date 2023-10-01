const express = require('express');
const multer = require('multer');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const fluentFfmpeg = require('fluent-ffmpeg');
const { validationResult } = require('express-validator');
const { env } = require('process');
const bodyParser = require('body-parser');

const app = express();
const port = 3000;
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json({ limit: '50MB', type: 'application/json' }));

// Create an SQLite database
const db = new sqlite3.Database('recordings.db');

// Initialize the database schema
db.serialize(() => {
  db.run('CREATE TABLE IF NOT EXISTS recordings (id TEXT PRIMARY KEY, url TEXT, metadata TEXT)');
});

// Create an array to store received blobs
const blobArray = [];
const maxChunks = 3; // Changed maxChunks to 3

// Set up Multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Function to generate a unique ID
function generateUniqueId() {
  return Math.random().toString(36).substring(2, 15);
}

// Function to transcribe audio using OpenAI API
async function transcribeAudio(blobData) {
  try {
    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', {
      audio: blobData,
      model: 'whisper-1',
    }, {
      headers: {
        Authorization: process.env.APIKEY,
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
  const outputFilePath = `./recordings/${session.id}.webm`;

  // Check if there are no blobs in the session data
  if (session.data.length === 0) {
    return callback(new Error('No input specified'));
  }

  // Initialize the FFmpeg command
  const ffmpegCommand = fluentFfmpeg()
    .inputOptions('-f s16le')
    .inputOptions('-acodec pcm_s16le')
    .inputOptions('-i pipe:0')
    .inputOptions('-framerate 30') // Adjust as needed
    .inputOptions('-video_size 1920x1080') // Adjust as needed
    .audioCodec('aac')
    .videoCodec('libx264')
    .on('end', () => {
      const metadata = { duration: 60 };
      callback(null, outputFilePath, metadata);
    })
    .on('error', (err) => {
      callback(err);
    });

  // Add input streams for each blob in session.data
  session.data.forEach((blob, index) => {
    ffmpegCommand.input(`pipe:${index + 1}`);
  });

  // Merge the input streams and output to the specified file
  ffmpegCommand
    .complexFilter('concat=n=2:v=1:a=1[v0][a0]', ['[v0]scale=1920:1080[v]'])
    .output(outputFilePath, { end: true })
    .pipe(fs.createWriteStream(outputFilePath, { flags: 'w' }));
}


// Route for starting the recording
app.post('/start', (req, res) => {
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
app.post('/sendBlob/:id', upload.single('videoChunk'), async (req, res) => {
  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const fileId = req.params.id;
  const { binary } = req.body;

  const blobData = Buffer.from(new Uint8Array(binary));
  // Find the corresponding recording session
  const session = blobArray.find((session) => session.id === fileId);
  if (!session) {
    return res.status(404).json({ error: 'Recording session not found' });
  }

  // Add the received blob to the session data
  session.data.push(blobData);

  // Check if the session has reached maxChunks and trigger processing
  if (session.data.length >= maxChunks) {
    try {
      const outputFilePath = `./recordings/${session.id}.webm`;
      const metadata = { duration: 60 };

      await processRecording(session, async (err) => {
        if (err) {
          res.status(500).json({ error: 'Error processing recording' });
        } else {
          const transcription = await transcribeAudio(session.data.join(''));

          // Save recording metadata to the database
          db.serialize(() => {
            const stmt = db.prepare('INSERT INTO recordings VALUES (?, ?, ?)');
            stmt.run(session.id, outputFilePath, JSON.stringify({ ...metadata, transcription }));
            stmt.finalize();
          });

          res.json({ message: 'Recording processed successfully' });
        }
      });
    } catch (error) {
      res.status(500).json({ error: 'Error processing recording' });
    } finally {
      // Clear the session data
      session.data = [];
    }
  } else {
    res.json({ message: 'Blob received' });
  }
});

app.post('/stop/:id', upload.single('videoChunk'), (req, res) => {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
  
    const fileId = req.params.id;
    const lastBlob = req.file.buffer;
  
    // Find the corresponding recording session
    const session = blobArray.find((session) => session.id === fileId);
    if (!session) {
      return res.status(404).json({ error: 'Recording session not found' });
    }
  
    // Add the last blob to the session data
    session.data.push(lastBlob);
  
    // Check if the session has reached maxChunks and trigger processing
      try {
        const outputFilePath = `./recordings/${session.id}.webm`;
        const metadata = { duration: 60 };
  
        processRecording(session, async (err) => {
          if (err) {
            res.status(500).json({ error: 'Error processing recording' });
          } else {
            const transcription = await transcribeAudio(session.data.join(''));
  
            // Save recording metadata to the database
            db.serialize(() => {
              const stmt = db.prepare('INSERT INTO recordings VALUES (?, ?, ?)');
              stmt.run(session.id, outputFilePath, JSON.stringify({ ...metadata, transcription }));
              stmt.finalize();
            });
  
            res.json({ message: 'Recording processed successfully' });
          }
        });
      } catch (error) {
        res.status(500).json({ error: error });
      } finally {
        // Clear the session data
        session.data = [];
      }
 
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

    const videoFilePath = row.url;

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
