import { createFileRoute } from "@tanstack/react-router";
import { Archive } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/console/inventory/stock")({
  component: CurrentStockPage,
});

function CurrentStockPage() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-chat-canvas p-4 md:p-6">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Archive className="h-4 w-4 text-muted-foreground" />
          Current Stock
        </h1>
        <p className="text-sm text-muted-foreground">
          Transco-owned box supplies on hand — kept separate from Warehouse Cargo (customer goods in
          our custody) and from Packaging Activity (usage recorded on shipments).
        </p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm">Current Stock</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="flex items-start gap-2 rounded-md bg-secondary/40 p-3 text-sm text-muted-foreground">
            <Archive className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium text-foreground">Not configured</p>
              <p className="mt-0.5 text-xs">
                Enter a physical opening stock count to begin live stock tracking. Until then, no
                current-quantity number is shown here.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
