import Image from "next/image";
import logo from "../../public/logo.png";
import logoVertical from "../../public/logo_v.png";

// "wordmark" (logo.png) is the wide header logo, trimmed to the artwork so `height` is the visible mark
// height. "stacked" (logo_v.png) is the icon-over-wordmark version for the login page; it has built-in
// padding, so give it more height than you'd think.
export function Logo({
  height = 24,
  priority,
  variant = "wordmark",
}: {
  height?: number;
  priority?: boolean;
  variant?: "wordmark" | "stacked";
}) {
  return (
    <Image
      src={variant === "stacked" ? logoVertical : logo}
      alt="resume.buzz"
      priority={priority}
      style={{ height, width: "auto" }}
      className="block select-none"
    />
  );
}
