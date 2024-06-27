import {motion} from "framer-motion";


export default function ToastNotification({isModalVisible,text}){
    return(
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={
            isModalVisible ? { opacity: 1, y: 0 } : { y: 20, opacity: 0 }
          }
          transition={{ duration: 0.5 }}
          className="absolute bottom-10 text-center w-full flex items-center justify-center "
        >
          <div className="rounded-2xl p-2 border-2 border-black w-40">
            {text}
          </div>
        </motion.div>
    )
}