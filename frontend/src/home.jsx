import { motion, useAnimation } from "framer-motion";
import { Link } from "react-router-dom";
import serverAddress from "./utils/serverLink";
import GitHubLink from "./components/githublink";

const divStyle = `justify-center items-center flex rounded-3xl w-[150px] `;
const MotionLink = motion(Link);

export default function Home() {
  const sendControls = useAnimation();
  const receiveControls = useAnimation();
  fetch(serverAddress);
  return (
    <>
      <div className="flex h-screen select-none items-center text-2xl font-medium font-mono justify-center align-middle w-screen overflow-hidden bg-black gap-7">
        <div
          className="p-4"
          onMouseEnter={() => sendControls.start("hover")}
          onMouseLeave={() => sendControls.start("initial")}
        >
          <MotionLink
            className={divStyle + "bg-blue-500"}
            animate={sendControls}
            variants={{
              initial: {
                scale: 1,
                width: "150px",
                height: "auto",
                transform: "translateX(0px)",
                fontSize: "20px",
              },
              hover: {
                width: "30vw",
                height: "30vh",
                transform: "translateX(-200px)",
                fontSize: "40px",
                transition: { duration: 0.6, type: "spring" },
              },
            }}
            to="/send"
          >
            <motion.div className="p-10 select-none">Send</motion.div>
          </MotionLink>
        </div>
      <div className="p-4"
              onMouseEnter={() => receiveControls.start("hover")}
          onMouseLeave={() => receiveControls.start("initial")}
      >  <MotionLink
          to="/receive"
          className={divStyle + "bg-red-500"}
             animate={receiveControls}
            variants={{
              initial: {
                scale: 1,
                width: "150px",
                height: "auto",
                transform: "translateX(0px)",
                fontSize: "20px",
              },
              hover: {
                width: "30vw",
                height: "30vh",
                transform: "translateX(200px)",
                fontSize: "40px",
                transition: { duration: 0.6, type: "spring" },
              },
            }}
        >
          <motion.div className="p-10">Receive</motion.div>
        </MotionLink></div>
        <GitHubLink />
      </div>
    </>
  );
}
