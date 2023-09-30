
### API Documentation

Welcome to the API documentation for the Audio-Video Processing API. This API allows you to start audio and video recording sessions, process recorded data, transcribe audio, and retrieve processed video data in chunks.

#### Base URL

```
https://screen-recorder.fly.dev/
```

### Authentication

This API does not require authentication.

### Endpoints

#### Start a Recording Session

- **Endpoint**: `/start`
- **HTTP Method**: POST
- **Description**: Start a new recording session and receive a unique session ID.
- **Request Body**:

  - `file` (multipart/form-data): The audio or video file to be recorded (max size: 25MB).

- **Response**:

  - `id` (string): A unique session ID.

#### Send Blob Data

- **Endpoint**: `/sendBlob/:id`
- **HTTP Method**: POST
- **Description**: Send blobs intermittently to an ongoing recording session.
- **URL Parameters**:

  - `id` (string): The session ID received from the `/start` endpoint.

- **Request Body**:

  - `blob` (string, base64-encoded): The audio or video blob data.

- **Response**:

  - `message` (string): Indicates the success of blob submission.

#### Stop a Recording Session

- **Endpoint**: `/stop/:id`
- **HTTP Method**: POST
- **Description**: Stop a recording session and send the last blob data.
- **URL Parameters**:

  - `id` (string): The session ID received from the `/start` endpoint.

- **Request Body**:

  - `blob` (string, base64-encoded): The last audio or video blob data.

- **Response**:

  - `message` (string): Indicates the success of stopping the recording.

#### Retrieve Processed Video Data

- **Endpoint**: `/recordings/:id`
- **HTTP Method**: GET
- **Description**: Retrieve processed video data in smaller chunks as byte data.
- **URL Parameters**:

  - `id` (string): The session ID received from the `/start` endpoint.

- **Response**:

  - Video data as byte chunks.

### Usage Example

#### Starting a Recording Session

```bash
POST https://screen-recorder.fly.dev/start

Request Body:
- file: (audio or video file)
```

Response:

```json
{
  "id": "unique_session_id"
}
```

#### Sending Blob Data

```bash
POST https://screen-recorder.fly.dev/sendBlob/unique_session_id

Request Body:
- blob: (base64-encoded audio or video blob)
```

Response:

```json
{
  "message": "Blob received"
}
```

#### Stopping a Recording Session

```bash
POST https://screen-recorder.fly.dev/stop/unique_session_id

Request Body:
- blob: (base64-encoded audio or video blob)
```

Response:

```json
{
  "message": "Recording updated"
}
```

#### Retrieving Processed Video Data

```bash
GET https://screen-recorder.fly.dev/recordings/unique_session_id
```

Response:

```plaintext
(video data as byte chunks)
```

### Error Handling

- The API returns appropriate HTTP status codes for different error scenarios, such as 400 for validation errors and 500 for internal server errors.

### Rate Limiting

- This API does not have rate limiting.

### Security

- Input validation is implemented to ensure the security of the API.
- CORS (Cross-Origin Resource Sharing) is handled to allow requests from different domains.

### Versioning

- This API does not currently support versioning.

This is a basic structure for API documentation. You can expand on this by including more details, example requests, and responses for each endpoint, as well as any specific parameters or headers required.