import type { Prefs } from "@/lib/data";
import { Field, Input, Select } from "./ui";
import { SubmitButton } from "./client";
import { ActionForm } from "./action-form";
import { savePreferences } from "@/app/actions/settings";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ZONES = ["Asia/Manila", "Asia/Singapore", "Asia/Tokyo", "Asia/Dubai", "Europe/London", "America/Los_Angeles", "America/New_York", "UTC"];

export function PreferencesForm({ prefs, onboarding = false }: { prefs: Prefs; onboarding?: boolean }) {
  return (
    <ActionForm action={savePreferences} className="flex flex-col gap-4">
      {onboarding && <input type="hidden" name="finishOnboarding" value="1" />}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Daily study target (minutes)" htmlFor="p-target">
          <Input id="p-target" name="dailyTarget" type="number" min={15} max={960} defaultValue={prefs.daily_target_minutes} />
        </Field>
        <Field label="Preferred session length (minutes)" htmlFor="p-session">
          <Input id="p-session" name="session" type="number" min={10} max={180} defaultValue={prefs.session_minutes} />
        </Field>
        <Field label="Break between sessions (minutes)" htmlFor="p-break">
          <Input id="p-break" name="breakMin" type="number" min={0} max={60} defaultValue={prefs.break_minutes} />
        </Field>
      </div>
      <fieldset>
        <legend className="mb-2 text-xs font-medium text-muted">Days you study</legend>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d, i) => (
            <label key={d} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm has-[:checked]:border-gold/60 has-[:checked]:text-ivory">
              <input type="checkbox" name="days" value={i} defaultChecked={prefs.available_days.includes(i)} className="accent-[#D6B36A]" />
              {d}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Preferred start time" htmlFor="p-start">
          <Input id="p-start" name="start" type="time" defaultValue={String(prefs.preferred_start).slice(0, 5)} />
        </Field>
        <Field label="Preferred end time" htmlFor="p-end">
          <Input id="p-end" name="end" type="time" defaultValue={String(prefs.preferred_end).slice(0, 5)} />
        </Field>
        <Field label="Time zone" htmlFor="p-tz">
          <Select id="p-tz" name="timezone" defaultValue={prefs.timezone}>
            {[...new Set([prefs.timezone, ...ZONES])].map((z) => (
              <option key={z}>{z}</option>
            ))}
          </Select>
        </Field>
      </div>
      {!onboarding && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="reminders" defaultChecked={prefs.reminders_enabled} className="mt-1 accent-[#D6B36A]" />
          <span>
            Remind me about today&apos;s plan
            <span className="block text-xs text-faint">Saved as a preference. This version shows reminders inside the app only; it does not send emails or push notifications yet.</span>
          </span>
        </label>
      )}
      <div>
        <SubmitButton>{onboarding ? "Save and go to Home" : "Save preferences"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
