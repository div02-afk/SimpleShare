import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import GitHubLink from "./components/githublink";

const sections = [
  {
    title: "1. Signaling",
    text: "The backend server creates a short room code, uses Socket.IO to relay offers, answers, ICE candidates, metadata, and progress events between two browsers, and provides Cloudflare-backed STUN and TURN servers for WebRTC connectivity.",
  },
  {
    title: "2. Sender setup",
    text: "The sender page requests a code from `/random`, joins that room, opens 12 peer connections, and creates multiple data channels so the transfer can run in parallel.",
  },
  {
    title: "3. Receiver setup",
    text: "The receiver enters the same code, joins the room, accepts the WebRTC offers, returns answers, and prepares an indexed chunk list for reconstruction.",
  },
  {
    title: "4. File transfer",
    text: "The sender reads the file in 128 KB chunks, sends metadata first, then distributes encoded chunks across WebRTC data channels instead of sending the file through the server.",
  },
  {
    title: "5. Progress + finish",
    text: "The receiver stores each chunk by index, reports progress back through Socket.IO, and once the completion marker arrives it rebuilds the Blob and triggers the download locally.",
  },
  {
    title: "6. Core idea",
    text: "The server only helps both browsers find each other. The actual file remains peer-to-peer, which means there is no server-side file storage during the transfer.",
  },
] as const;

export default function ProjectOverview() {
  return (
    <div className="min-h-screen bg-black px-6 py-8 font-mono text-white">
      <div className="mx-auto max-w-4xl">
        <div className="mb-10 flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link to="/" className="text-xl font-semibold">
              SimpleShare
            </Link>
            <h1 className="mt-4 text-4xl">How the project works</h1>
            <p className="mt-4 max-w-3xl text-base text-gray-300">
              SimpleShare uses Socket.IO for signaling, WebRTC for the actual
              file transfer, and Cloudflare-provided STUN and TURN servers to
              help peers establish the best available connection. The server
              coordinates the connection, but the file itself moves directly
              between peers whenever possible.
            </p>
          </div>

          <div className="flex gap-3 text-sm">
            <Link
              to="/send"
              className="rounded-md border border-white bg-black px-4 py-2 transition hover:bg-white hover:text-black"
            >
              Send
            </Link>
            <Link
              to="/receive"
              className="rounded-md border border-white bg-black px-4 py-2 transition hover:bg-white hover:text-black"
            >
              Receive
            </Link>
          </div>
        </div>

        <div className="space-y-5">
          {sections.map((section, index) => (
            <motion.div
              key={section.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: index * 0.05 }}
              className="border-b border-white/20 pb-5"
            >
              <h2 className="text-2xl text-gray-200">{section.title}</h2>
              <p className="mt-3 text-base leading-7 text-gray-400">
                {section.text}
              </p>
            </motion.div>
          ))}
        </div>

      </div>

      <GitHubLink />
    </div>
  );
}
