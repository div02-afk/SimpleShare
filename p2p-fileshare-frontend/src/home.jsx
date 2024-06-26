import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
export default function Home() {
  const divStyle = ` justify-center items-center flex rounded-3xl `;

  return (
    <>
      <div className="flex h-screen items-center justify-center align-middle w-screen overflow-hidden bg-black gap-7">
        <motion.div
          className={divStyle + "bg-blue-500 "}
          whileHover={{
            width: "60%",
            height: "60%",
            transform: "translateX(-200px)",
            fontSize: "5rem",
            transition: { duration: 1, type: "spring" },
          }}
        >
          <Link to="/send">
            <motion.div className="p-10 select-none">Send</motion.div>
          </Link>
        </motion.div>
        <motion.div
          className={divStyle + "bg-red-500"}
          whileHover={{
            width: "60%",
            height: "60%",
            transform: "translateX(200px)",
            fontSize: "5rem",
            transition: { duration: 1, type: "spring" },
          }}
        >
          <Link to="/receive">
            <motion.div className="p-10">Receive</motion.div>
          </Link>
        </motion.div>
      </div>
    </>
  );
}
