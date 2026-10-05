import {
  Bath,
  Bug,
  Cable,
  Columns3,
  Construction,
  DoorOpen,
  Drill,
  Droplet,
  Droplets,
  Frame,
  Gauge,
  Hammer,
  HardHat,
  Lightbulb,
  type LucideIcon,
  Nut,
  Package,
  PaintRoller,
  Pipette,
  Plug,
  ShowerHead,
  Sparkles,
  Spline,
  Fan,
  Wrench,
  Zap,
} from "lucide-react";

/**
 * Departments are the tenant's own free-text categories, so the icon is
 * picked by what the name says. Order matters: "Cable Trays" must match the
 * tray rule before the cable one, "Power Tools" before "Hand Tools".
 */
const RULES: [RegExp, LucideIcon][] = [
  [/tray|channel/, Columns3],
  [/trunking|conduit/, Spline],
  [/wire|cable/, Cable],
  [/switch|socket|plug|extension/, Plug],
  [/breaker|bracker|isolator|rccb|mcb/, Zap],
  [/pump|motor|pressure|float/, Gauge],
  [/light|lamp|led/, Lightbulb],
  [/fan|ventilat/, Fan],
  [/power tool|drill|grinder|weld|heat gun/, Drill],
  [/hand tool|cutter|spanner|plier|wrench/, Wrench],
  [/screw|bolt|fixing|nail|fastener|anchor/, Nut],
  [/door|cabinet|hinge|lock|handle/, DoorOpen],
  [/bracket|mount/, Frame],
  [/adhesive|sealant|silicon/, Pipette],
  [/safety|ppe|glove/, HardHat],
  [/clean|drain|acid|soda/, Sparkles],
  [/paint|thinner|undercoat|filler/, PaintRoller],
  [/shower|shattaf/, ShowerHead],
  [/tap|mixer|faucet/, Droplets],
  [/bath|toilet|seat|strainer|sanitary/, Bath],
  [/plumb|pipe|valve|hose|nipple|fitting/, Droplet],
  [/pest|insect/, Bug],
  [/building|polythene|construction/, Construction],
  [/electric/, Zap],
  [/hardware|tool/, Hammer],
];

export function departmentIcon(name: string): LucideIcon {
  const key = name.toLowerCase();
  return RULES.find(([pattern]) => pattern.test(key))?.[1] ?? Package;
}
