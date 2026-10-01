"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatQty } from "@/lib/format";

/** Room size → boxes to buy, including a wastage allowance for cuts. */
export function TileCalculator({ boxArea, onUse }: { boxArea: number; onUse: (boxes: number) => void }) {
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [waste, setWaste] = useState(10);
  const area = Number(length) * Number(width);
  const needed = area > 0 ? area * (1 + waste / 100) : 0;
  const boxes = needed > 0 ? Math.ceil(needed / boxArea - 1e-9) : 0;

  return (
    <div className="rounded-[var(--radius-panel)] border border-galv bg-sheet p-4">
      <h3 className="text-lg">How many boxes do I need?</h3>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <label className="text-sm">
          <span className="text-steel">Length (m)</span>
          <input inputMode="decimal" value={length} onChange={(e) => setLength(e.target.value)} className="mt-1 h-10 w-full rounded-[var(--radius-tag)] border border-galv bg-paper px-2" />
        </label>
        <label className="text-sm">
          <span className="text-steel">Width (m)</span>
          <input inputMode="decimal" value={width} onChange={(e) => setWidth(e.target.value)} className="mt-1 h-10 w-full rounded-[var(--radius-tag)] border border-galv bg-paper px-2" />
        </label>
        <label className="text-sm">
          <span className="text-steel">Extra for cuts</span>
          <select value={waste} onChange={(e) => setWaste(Number(e.target.value))} className="mt-1 h-10 w-full rounded-[var(--radius-tag)] border border-galv bg-paper px-2">
            <option value={5}>5%</option>
            <option value={10}>10% (straight)</option>
            <option value={15}>15% (diagonal)</option>
          </select>
        </label>
      </div>
      {boxes > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[15px]">
            {formatQty(Math.round(area * 100) / 100)} m² + {waste}% = {formatQty(Math.round(needed * 100) / 100)} m² →{" "}
            <strong className="font-cond text-xl">{boxes} boxes</strong> ({formatQty(Math.round(boxes * boxArea * 100) / 100)} m²)
          </p>
          <Button size="sm" variant="secondary" onClick={() => onUse(boxes)}>
            Use {boxes} boxes
          </Button>
        </div>
      )}
    </div>
  );
}
