# SimpleShare

Welcome to the SimpleShare project! This project provides a secure and efficient way to share files between browsers using WebRTC. It uses Cloudflare-provided STUN and TURN servers to establish the best available connection, prefers direct peer-to-peer transfer when possible, and never stores transferred files on the server. For large files, the project splits them into manageable parts to ensure smooth transfer.

## Features

- **WebRTC-Based File Sharing**: Utilizes WebRTC with Cloudflare-provided STUN and TURN servers, preferring direct peer-to-peer connections and falling back to relay only when needed.
- **Multiple Connections**: Establishes multiple connections to accelerate the file transfer process.
- **End-to-End Encryption**: Ensures that files are encrypted during transfer, providing high security and privacy.
- **No Server Storage**: Files are never stored on any server during the transfer, enhancing security and privacy.
- **File Splitting**: Automatically splits large files into smaller parts to facilitate easier and more reliable transfers.
- **WebSocket Server**: A server facilitates the initial signaling flow, serves the runtime `GET /ice-servers` WebRTC configuration, and exposes `GET /healthz` for platform health checks (including WebSocket/room metrics).


## Contributing

We welcome contributions to improve this project! Here are some ways you can contribute:

- Report bugs and issues
- Submit feature requests
- Create pull requests to fix bugs or add new features

## Development

The frontend now fetches its WebRTC ICE configuration at runtime from the backend's Cloudflare-backed `GET /ice-servers` endpoint. The backend returns the raw `RTCIceServer[]` array, including both STUN and TURN entries with temporary TURN credentials.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

