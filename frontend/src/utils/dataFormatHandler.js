const dataFormatHandler = (size) => {
  if (size < 1024) {
    return `${size} KB`;
  } else {
    return `${Math.round(size / 1024)} MB`;
  }
};

export default dataFormatHandler;
