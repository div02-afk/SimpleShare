const readFileChunk = (file, start, end) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const blob = file.slice(start, end);
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(e);
    reader.readAsArrayBuffer(blob);
  });
};

const splitFile = async (file) => {
  const partSize = 1024 * 1024; // 1 MB per part
  const totalParts = Math.ceil(file.size / partSize);
  const parts = [];
  for (let i = 0; i < totalParts; i++) {
    const start = i * partSize;
    const end = Math.min(start + partSize, file.size);
    const chunk = file.slice(start, end);
    parts.push(chunk);
  }
  console.log("File split into", parts.length, "parts");
  return parts;
};

export default splitFile;
