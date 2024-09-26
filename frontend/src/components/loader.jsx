import { Grid } from "react-loader-spinner";

export default function Loader({
    height,width
}) {
  return (
    <Grid
      type="ThreeDots"
      color="rgba(255,255,255,0.4)"
      height={height || 40}
      width={width || 40}
    />
  );
}
