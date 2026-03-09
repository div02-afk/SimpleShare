import { Grid } from "react-loader-spinner";

interface LoaderProps {
  height?: number;
  width?: number;
}

export default function Loader({ height = 40, width = 40 }: LoaderProps) {
  return (
    <Grid
      color="rgba(255,255,255,0.4)"
      height={height}
      width={width}
    />
  );
}
