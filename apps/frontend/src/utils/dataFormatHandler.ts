const dataFormatHandler = (size: number): string => {
  if (!size) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let formattedSize = size;
  let unitIndex = 0;

  while (formattedSize >= 1024 && unitIndex < units.length - 1) {
    formattedSize /= 1024;
    unitIndex += 1;
  }

  const roundedSize =
    unitIndex === 0 ? Math.round(formattedSize) : formattedSize.toFixed(1);

  return `${roundedSize} ${units[unitIndex]}`;
};

export const transferRateFormatHandler = (sizePerSecond: number): string => {
  return `${dataFormatHandler(sizePerSecond)}/s`;
};

export default dataFormatHandler;
