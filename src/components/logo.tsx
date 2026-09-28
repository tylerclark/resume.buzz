import Image from "next/image";
import logo from "../../public/logo.png";

// logo.png is trimmed to the artwork, so `height` is the visible mark height.
export function Logo({ height = 24, priority }: { height?: number; priority?: boolean }) {
  return (
    <Image
      src={logo}
      alt="resume.buzz"
      priority={priority}
      style={{ height, width: "auto" }}
      className="block select-none"
    />
  );
}
