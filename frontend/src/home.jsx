import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import serverAddress from "./utils/serverLink";
import GitHubLink from "./components/githublink";

export default function Home() {
  const divStyle = ` justify-center items-center flex rounded-3xl w-[150px] `;
  const MotionLink = motion(Link);
  const response = fetch(serverAddress);
  return (
    <>
      <div className="flex h-screen select-none items-center text-2xl font-medium font-mono justify-center align-middle w-screen overflow-hidden bg-black gap-7">
        <MotionLink
          className={divStyle + "bg-blue-500"}
          whileHover={{
            width: "30%",
            height: "30%",
            transform: "translateX(-200px)",
            fontSize: "40px",
            transition: { duration: 0.6, type: "spring" },
          }}
          to="/send"
        >
          <motion.div className="p-10 select-none">Send</motion.div>
        </MotionLink>
        <MotionLink
          to="/receive"
          className={divStyle + "bg-red-500"}
          whileHover={{
            width: "30%",
            height: "30%",
            transform: "translateX(200px)",
            fontSize: "40px",
            transition: { duration: 0.6, type: "spring" },
          }}
        >
          <motion.div className="p-10">Receive</motion.div>
        </MotionLink>
        <GitHubLink />
      </div>
    </>
  );
}
