import { createFileRoute } from "@tanstack/react-router";
import { TeamMonthGrid } from "@/components/TeamMonthGrid";

export const Route = createFileRoute("/roster")({
  component: RosterPage,
});

function RosterPage() {
  return (
    <div className="max-w-6xl mx-auto">
      <TeamMonthGrid />
    </div>
  );
}
