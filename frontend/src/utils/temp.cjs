const fs = require("fs");
const os = require("os");
const readline = require("readline");

const readInterface = readline.createInterface({
  input: fs.createReadStream("./servers.txt"),
  console: false,
});

let result = [];

readInterface.on("line", function (line) {
  result.push({ urls: `stun:${line}` }), +os.EOL;
});

readInterface.on("close", () => {
  console.log(result);
  fs.writeFile("./servers.json", JSON.stringify(result), () => {
    console.log("Done.");
  });
});