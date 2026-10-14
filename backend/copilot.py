"""Wayout Copilot - LOCAL, RULE-BASED scenario interpreter.

This is NOT a language model. It is deterministic keyword / regex parsing that turns a
few kinds of requests into structured UI actions. It implements the `ScenarioInterpreter`
interface so it can be replaced by `NemotronScenarioInterpreter` later without touching
the API or the frontend (which only executes the returned actions).
"""
from __future__ import annotations

import re
from typing import Any, Dict, List

from interfaces import ScenarioInterpreter

EXIT_WORDS = {
    "A": ("exit a", "north exit", "north door", "top exit"),
    "B": ("exit b", "east exit", "east door", "right exit"),
    "C": ("exit c", "west exit", "west door", "left exit"),
    "D": ("exit d", "south exit", "south door", "bottom exit"),
}
SIDE = {"A": "north", "B": "east", "C": "west", "D": "south"}
BLOCK_WORDS = ("block", "closed", "close", "jam", "fire", "obstruct", "unavailable", "out of service", "inaccessible")
UNBLOCK_WORDS = ("unblock", "reopen", "re-open", "clear the", "open again", "unlock")


class RuleBasedScenarioInterpreter(ScenarioInterpreter):
    name = "LocalRuleBasedInterpreter"

    HELP = ("I understand commands such as: \"increase occupancy by 20%\", \"make the corridor wider\", "
            "\"what happens if the east exit is blocked?\", \"add an exit\", \"widen the exits\", "
            "\"run the evacuation\", \"predict\", \"save scenario\" or \"reset\".")

    def interpret(self, text: str, params: Dict[str, Any]) -> Dict[str, Any]:
        t = " " + re.sub(r"\s+", " ", text.lower().strip()) + " "
        changes: Dict[str, Any] = {}
        notes: List[str] = []
        actions: List[Dict[str, Any]] = []

        occ = int(params.get("occupancy", 140))
        cw = float(params.get("corridor_width", 2.0))
        ew = float(params.get("exit_width", 1.2))
        ne = int(params.get("num_exits", 2))
        blocked = [b for b in params.get("blocked_exits", [])]
        active = ["A", "B", "C", "D"][:ne]

        if "reset" in t or "start over" in t:
            return self._out(["Resetting to the baseline design."], [{"type": "reset"}], True)
        if " demo" in t:
            return self._out(["Starting the scripted demo."], [{"type": "demo"}], True)

        # --- exits blocked / reopened -------------------------------------------------
        for eid, words in EXIT_WORDS.items():
            if any(w in t for w in words):
                if any(w in t for w in UNBLOCK_WORDS):
                    if eid in blocked:
                        blocked.remove(eid); changes["blocked_exits"] = blocked
                        notes.append(f"Reopening Exit {eid} ({SIDE[eid]}).")
                elif any(w in t for w in BLOCK_WORDS):
                    if eid not in active:
                        notes.append(f"Exit {eid} ({SIDE[eid]}) does not exist in this design - active exits: "
                                     f"{', '.join(active)}.")
                    elif eid in blocked:
                        notes.append(f"Exit {eid} is already blocked.")
                    elif len(blocked) + 1 >= len(active):
                        notes.append("At least one exit must stay open.")
                    else:
                        blocked.append(eid); changes["blocked_exits"] = sorted(blocked)
                        notes.append(f"Blocking Exit {eid} ({SIDE[eid]}).")

        # --- occupancy -------------------------------------------------------------------
        if re.search(r"occupan|people|occupants|crowd|headcount|persons|staff", t):
            m = re.search(r"(\d+(?:\.\d+)?)\s*(?:%|percent)", t)
            up = any(w in t for w in ("increase", "more", "add", "raise", "up ", "higher", "grow"))
            down = any(w in t for w in ("decrease", "reduce", "fewer", "lower", "cut", "less", "drop"))
            if m and (up or down):
                pct = float(m.group(1)) / 100.0
                new = round(occ * (1 + pct if up else 1 - pct))
                changes["occupancy"] = int(min(300, max(20, new)))
                notes.append(f"Occupancy {occ} -> {changes['occupancy']} ({'+' if up else '-'}{m.group(1)}%).")
            else:
                m2 = re.search(r"(?:occupancy|people|occupants|headcount)\D{0,14}(\d{2,3})\b", t)
                if m2:
                    changes["occupancy"] = int(min(300, max(20, int(m2.group(1)))))
                    notes.append(f"Setting occupancy to {changes['occupancy']}.")

        # --- corridor width ----------------------------------------------------------------
        if "corridor" in t or "hallway" in t:
            m = re.search(r"(?:corridor|hallway)\D{0,22}?(\d+(?:\.\d+)?)\s*(?:m|meter|metre|metres|meters)?\b", t)
            wide = any(w in t for w in ("wider", "widen", "increase", "bigger", "expand", "broader", "larger"))
            narrow = any(w in t for w in ("narrow", "shrink", "reduce", "smaller", "decrease"))
            if m and not (wide or narrow) and 0.8 <= float(m.group(1)) <= 6.0:
                changes["corridor_width"] = round(float(m.group(1)), 2)
                notes.append(f"Setting corridor width to {changes['corridor_width']:.2f} m.")
            elif wide or narrow:
                step = 0.5 if wide else -0.5
                changes["corridor_width"] = round(min(4.0, max(1.0, cw + step)), 2)
                notes.append(f"Corridor width {cw:.2f} m -> {changes['corridor_width']:.2f} m.")

        # --- exits ----------------------------------------------------------------------------
        if re.search(r"exit|door", t) and re.search(r"wider|widen|bigger|larger|broader", t) and "corridor" not in t:
            changes["exit_width"] = round(min(3.0, ew + 0.3), 2)
            notes.append(f"Exit width {ew:.2f} m -> {changes['exit_width']:.2f} m.")
        if re.search(r"(add|extra|another|more|new)\s+(an\s+)?exits?", t):
            if ne < 4:
                changes["num_exits"] = ne + 1
                notes.append(f"Adding an exit ({ne} -> {ne + 1}).")
            else:
                notes.append("The design already has the maximum of 4 exits.")
        if re.search(r"(remove|fewer|delete)\s+(an\s+)?exits?", t) and ne > 1:
            changes["num_exits"] = ne - 1
            notes.append(f"Removing an exit ({ne} -> {ne - 1}).")

        # --- commands ------------------------------------------------------------------------
        wants_run = bool(re.search(r"\b(run|simulate|simulation|evacuat|start|analy[sz]e|what happens|what if|test)\w*", t))
        wants_pred = bool(re.search(r"\b(predict|estimate|forecast|quick|fast ai|surrogate)\w*", t))
        wants_save = bool(re.search(r"\b(save|store)\b", t))

        if changes:
            actions.append({"type": "set_params", "changes": changes})
        if wants_pred and not wants_run:
            actions.append({"type": "predict"})
            notes.append("Running the fast AI prediction.")
        if wants_run or (changes and "what" in t):
            actions.append({"type": "run_simulation", "compare": bool(changes)})
            notes.append("Running the evacuation simulation" + (" and comparing with the baseline." if changes else "."))
        if wants_save:
            actions.append({"type": "save_scenario"})
            notes.append("Saving the current design as a scenario.")

        if not actions and not notes:
            return self._out([self.HELP], [], False)
        if changes and not (wants_run or wants_pred or wants_save):
            notes.append("Design updated - say \"run the evacuation\" to simulate it.")
        return self._out(notes, actions, True)

    def _out(self, notes: List[str], actions: List[Dict[str, Any]], matched: bool) -> Dict[str, Any]:
        return {"interpreter": self.name, "matched": matched, "reply": " ".join(notes), "actions": actions}


class NemotronScenarioInterpreter(ScenarioInterpreter):
    """Placeholder for the future LLM-backed interpreter. NOT implemented in this prototype."""
    name = "NemotronScenarioInterpreter"

    def interpret(self, text: str, params: Dict[str, Any]) -> Dict[str, Any]:
        raise NotImplementedError("Plug NVIDIA Nemotron in here: return the same {reply, actions[]} structure.")
