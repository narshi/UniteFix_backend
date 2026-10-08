/**
 * UniteFix Celebrations — the public pages, no sign-in:
 *
 *   /halls/<code>                    a hall's page and booking a date
 *   /photographers/<code>[/albums/<id>]  a photographer's portfolio and an album
 *   /celebrations                    search halls, photographers and planners
 *   /celebrations/plan[/<token>]     the client's plan, and a sent plan's progress
 *   /celebrations/b/<token>          a client's booking (also /events/e/<token> links)
 */

import HallPageView from "@/pages/celebrations/hall";
import BookingStatusPage from "@/pages/celebrations/booking";
import PhotographerPage, { AlbumPage } from "@/pages/celebrations/photographer";
import SearchPage from "@/pages/celebrations/search";
import { PlanPage, PlanStatusPage } from "@/pages/celebrations/plan";
import { Shell, NotFoundCard } from "@/components/celebrations/kit";

export default function CelebrationsRouter() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] === "halls" && parts[1]) return <HallPageView code={decodeURIComponent(parts[1])} />;
  if (parts[0] === "photographers" && parts[1] && parts[2] === "albums" && parts[3]) return <AlbumPage code={decodeURIComponent(parts[1])} id={Number(parts[3])} />;
  if (parts[0] === "photographers" && parts[1]) return <PhotographerPage code={decodeURIComponent(parts[1])} />;
  if (parts[0] === "celebrations" && parts[1] === "b" && parts[2]) return <BookingStatusPage token={parts[2]} />;
  if (parts[0] === "celebrations" && parts[1] === "plan" && parts[2]) return <PlanStatusPage token={parts[2]} />;
  if (parts[0] === "celebrations" && parts[1] === "plan") return <PlanPage />;
  if (parts[0] === "celebrations" && !parts[1]) return <SearchPage />;
  return <Shell><NotFoundCard /></Shell>;
}

export const isCelebrationsPath = (p: string) => /^\/(halls|photographers)\/[^/]+/.test(p) || p === "/celebrations" || p.startsWith("/celebrations/");
