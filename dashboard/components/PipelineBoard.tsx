'use client';
import { useState } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { AlertTriangle, DollarSign, Calendar } from 'lucide-react';
import { postCommand } from '@/lib/api';

export interface Opportunity {
  id: string;
  name: string;
  stage: string;
  value: number;
  close_date?: string;
  stalled_at?: string;
  leads?: { name: string };
}

const STAGES = ['prospect', 'proposal', 'negotiation', 'won', 'lost'] as const;
type Stage = typeof STAGES[number];

const STAGE_LABEL: Record<Stage, string> = {
  prospect:    'Prospect',
  proposal:    'Proposal',
  negotiation: 'Negotiation',
  won:         'Won',
  lost:        'Lost',
};

const STAGE_STYLE: Record<Stage, string> = {
  prospect:    'border-blue-500/30 bg-blue-500/5',
  proposal:    'border-indigo-500/30 bg-indigo-500/5',
  negotiation: 'border-orange-500/30 bg-orange-500/5',
  won:         'border-green-500/30 bg-green-500/5',
  lost:        'border-red-500/30 bg-red-500/5',
};

function daysSince(iso?: string) {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function fmt(v: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
}

// ── Draggable Card ────────────────────────────────────────────────────────────

function OppCard({ opp, isDragging }: { opp: Opportunity; isDragging?: boolean }) {
  const stalled = daysSince(opp.stalled_at) > 3;
  return (
    <div
      className={`bg-gray-900 border rounded-lg p-3 cursor-grab active:cursor-grabbing transition-all ${
        stalled ? 'border-red-500/40' : 'border-gray-800'
      } ${isDragging ? 'opacity-50 rotate-1' : 'hover:border-gray-600'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-white leading-snug">{opp.name}</p>
        {stalled && <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />}
      </div>
      {opp.leads?.name && (
        <p className="text-xs text-gray-500 mt-1">{opp.leads.name}</p>
      )}
      <div className="flex items-center gap-3 mt-2">
        <span className="flex items-center gap-1 text-xs text-green-400 font-medium">
          <DollarSign className="w-3 h-3" />
          {fmt(opp.value)}
        </span>
        {opp.close_date && (
          <span className="flex items-center gap-1 text-xs text-gray-500">
            <Calendar className="w-3 h-3" />
            {new Date(opp.close_date).toLocaleDateString()}
          </span>
        )}
      </div>
      {stalled && (
        <p className="text-[10px] text-red-400 mt-1.5">
          Stalled {daysSince(opp.stalled_at)}d
        </p>
      )}
    </div>
  );
}

function DraggableCard({ opp }: { opp: Opportunity }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: opp.id,
    data: { opp },
  });
  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <OppCard opp={opp} isDragging={isDragging} />
    </div>
  );
}

function StageColumn({
  stage,
  opps,
  businessId,
}: {
  stage: Stage;
  opps: Opportunity[];
  businessId: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const total = opps.reduce((s, o) => s + (o.value || 0), 0);

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col gap-2 min-w-[200px] flex-1 border rounded-xl p-3 transition-colors ${
        STAGE_STYLE[stage]
      } ${isOver ? 'ring-2 ring-indigo-500/50' : ''}`}
    >
      <div className="flex items-center justify-between mb-1 px-1">
        <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
          {STAGE_LABEL[stage]}
        </h3>
        <div className="text-right">
          <p className="text-xs text-gray-500">{opps.length}</p>
          {total > 0 && <p className="text-[10px] text-gray-600">{fmt(total)}</p>}
        </div>
      </div>
      <div className="flex flex-col gap-2 flex-1">
        {opps.map((opp) => (
          <DraggableCard key={opp.id} opp={opp} />
        ))}
        {opps.length === 0 && (
          <div className="flex-1 min-h-16 flex items-center justify-center">
            <p className="text-xs text-gray-700">Drop here</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Board ──────────────────────────────────────────────────────────────────────

interface PipelineBoardProps {
  opportunities: Opportunity[];
  businessId: string;
  onStageChange?: () => void;
}

export default function PipelineBoard({
  opportunities,
  businessId,
  onStageChange,
}: PipelineBoardProps) {
  const [items, setItems] = useState(opportunities);
  const [activeOpp, setActiveOpp] = useState<Opportunity | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const byStage = (stage: Stage) => items.filter((o) => o.stage === stage);

  const onDragStart = (event: DragStartEvent) => {
    const opp = items.find((o) => o.id === event.active.id);
    if (opp) setActiveOpp(opp);
  };

  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveOpp(null);
    if (!over || active.id === over.id) return;

    const opp = items.find((o) => o.id === active.id);
    const newStage = over.id as Stage;
    if (!opp || opp.stage === newStage) return;

    // Optimistic update
    setItems((prev) =>
      prev.map((o) => (o.id === opp.id ? { ...o, stage: newStage } : o))
    );

    // Fire through the existing permission layer
    try {
      await postCommand(
        `advance opportunity "${opp.name}" from ${opp.stage} to ${newStage}`,
        businessId
      );
      onStageChange?.();
    } catch {
      // Rollback
      setItems((prev) =>
        prev.map((o) => (o.id === opp.id ? { ...o, stage: opp.stage } : o))
      );
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-4">
        {STAGES.map((stage) => (
          <StageColumn
            key={stage}
            stage={stage}
            opps={byStage(stage)}
            businessId={businessId}
          />
        ))}
      </div>
      <DragOverlay>
        {activeOpp ? <OppCard opp={activeOpp} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
