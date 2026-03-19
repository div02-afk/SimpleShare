import { motion, useAnimation } from "framer-motion";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import GitHubLink from "./components/githublink";
import serverAddress from "./utils/serverLink";

const divStyle = "flex w-[150px] h-[110px] items-center justify-center rounded-3xl";
const MotionLink = motion(Link);

export default function Home() {
  const sendControls = useAnimation();
  const receiveControls = useAnimation();

  useEffect(() => {
    void fetch(serverAddress).catch(() => { });
  }, []);

  return (
    <div className="relative flex h-screen w-screen select-none items-center justify-center overflow-hidden bg-black font-mono text-2xl font-medium text-white">
      <div className="pointer-events-none absolute left-6 top-6 text-left">
        <h1 className="text-xl font-semibold">SimpleShare</h1>
      </div>

      <div className="absolute right-6 top-6">
        <Link
          to="/how-it-works"
          className="rounded-md border border-white px-4 py-2 text-sm transition hover:bg-white hover:text-black"
        >
          How it works
        </Link>
      </div>

      <div className="flex items-center justify-center gap-7">
        <div
          className="p-4"
          onMouseEnter={() => {
            void sendControls.start("hover");
          }}
          onMouseLeave={() => {
            void sendControls.start("initial");
          }}
        >
          <MotionLink
            className={`${divStyle} bg-blue-500`}
            animate={sendControls}
            variants={{
              initial: {
                scale: 1,
                width: "150px",
                height: "110px",
                transform: "translateX(0px)",
                fontSize: "20px",
              },
              hover: {
                width: "30vw",
                height: "30vh",
                transform: "translateX(-40%)",
                fontSize: "40px",
                transition: { duration: 0.6, type: "spring" },
              },
            }}
            to="/send"
          >
            <motion.div className="select-none p-10">Send</motion.div>
          </MotionLink>
        </div>

        <div
          className="p-4"
          onMouseEnter={() => {
            void receiveControls.start("hover");
          }}
          onMouseLeave={() => {
            void receiveControls.start("initial");
          }}
        >
          <MotionLink
            to="/receive"
            className={`${divStyle} bg-red-500`}
            animate={receiveControls}
            variants={{
              initial: {
                scale: 1,
                width: "150px",
                height: "110px",
                transform: "translateX(0px)",
                fontSize: "20px",
              },
              hover: {
                width: "30vw",
                height: "30vh",
                transform: "translateX(40%)",
                fontSize: "40px",
                transition: { duration: 0.6, type: "spring" },
              },
            }}
          >
            <motion.div className="p-10">Receive</motion.div>
          </MotionLink>
        </div>
      </div>

      <GitHubLink />
    </div>
  );
}
