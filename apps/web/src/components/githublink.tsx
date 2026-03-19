import { faGithub } from "@fortawesome/free-brands-svg-icons";
import type { IconProp } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { motion } from "framer-motion";

export default function GitHubLink() {
  return (
    <motion.div
      whileTap={{ scale: 0.95 }}
      initial={{ opacity: 1, color: "#f1f1f1" }}
      whileHover={{
        scale: 1.2,
        color: "#f1f1f1",
        transition: { duration: 0.3 },
      }}
      className="fixed bottom-5 left-6 z-10 cursor-pointer"
      onClick={() => {
        window.open("https://github.com/div02-afk/p2p-fileshare", "_blank");
      }}
    >
      <FontAwesomeIcon icon={faGithub as unknown as IconProp} size="sm" />
    </motion.div>
  );
}
