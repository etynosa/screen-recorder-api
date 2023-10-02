# screen-recorder-api

## RECORDING OF HOW IT WAS BUILT: https://drive.google.com/file/d/16sXK8M-xgvw5QBW43xeASq-aVgebHMwX/view?usp=drive_link

This is a README file for an Express.js application that allows you to record audio in chunks, save it to a local SQLite database, and transcribe the audio using the Deepgram API. The application is designed to handle audio recordings in chunks, making it suitable for scenarios where large audio files need to be transcribed.

## Prerequisites

Before you can run this application, ensure you have the following prerequisites installed:

- Node.js: You can download it from [https://nodejs.org/](https://nodejs.org/).
- npm (Node Package Manager): Usually comes with Node.js.
- SQLite3: You can install it using `npm install sqlite3`.
- Multer: You can install it using `npm install multer`.
- Express.js: You can install it using `npm install express`.
- Axios: You can install it using `npm install axios`.
- Body-parser: You can install it using `npm install body-parser`.

## Installation

1. Clone the repository or download the code to your local machine.

2. Navigate to the project directory using the command line.

3. Install the required dependencies using the following command:

   ```shell
   npm install
   ```

4. Create an account on [Deepgram](https://www.deepgram.com/) to obtain an API key. Replace `process.env.APIKEY` in the code with your Deepgram API key.

## Usage

To run the application, use the following command:

```shell
node app.js
```

The server will start, and you can access the following routes:

- `POST /start`: This route initiates a recording session and returns a unique ID for that session. It expects you to upload audio chunks using a form field named "videoChunk."

- `POST /sendBlob/:id`: Use this route to send audio chunks intermittently during a recording session. It expects a POST request with the session ID in the URL and the binary audio data in the request body.

- `POST /stop/:id`: This route is used to stop a recording session and save the audio data. It expects a POST request with the session ID in the URL and the final binary audio data in the request body.

- `GET /recordings/:id`: Retrieve processed audio data in chunks using this route. Provide the session ID in the URL, and the server will stream the audio data back as a webm file. It also includes the transcription as JSON.

## Database

The application uses SQLite to store information about the recordings. The database file is named "recordings.db," and it has a single table called "recordings" with columns for ID, URL, metadata, and transcription.

## Transcription

The application uses the Deepgram API to transcribe the recorded audio. When a recording is stopped, the audio is sent to Deepgram for transcription, and the result is stored in the database.

## Configuration

You can configure the maximum number of chunks per recording session by modifying the `maxChunks` variable in the code. Additionally, you can adjust the content type in the `transcribeAudio` function based on your audio format.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Acknowledgments

- This application is built using Express.js and several other open-source libraries.
