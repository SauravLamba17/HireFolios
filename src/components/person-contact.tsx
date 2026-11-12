// Contact controls for one person in a list (pool, bulk push): Call / WhatsApp / Mark contacted with the cooling
// warning, and a call-back. Server component; the controls inside are client components.
import { CallbackBox, ContactPanel } from "@/components/contact";
import { formatDayIST, todayIST } from "@/lib/ist";
import { coolingWarning, renderTemplates, whatsappAllowed, type Purpose } from "@/lib/rediscovery/contact";
import type { ContactState } from "@/lib/rediscovery/data";
import type { RediscoverySettings } from "@/lib/rediscovery/settings";

export function PersonContact({
  person,
  state,
  settings,
  company,
  hrName,
  position,
  purpose,
  pushId = null,
  withCallback = true,
}: {
  person: { id: string; name: string; mobile: string };
  state: ContactState;
  settings: RediscoverySettings;
  company: string;
  hrName: string;
  position: string;
  purpose: Purpose;
  pushId?: string | null;
  withCallback?: boolean;
}) {
  if (state.dnc) return <p className="text-sm font-medium text-red-800">Do not contact (they asked)</p>;
  const today = todayIST();
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-blue-700 underline">Contact / call-back</summary>
      <div className="mt-2 space-y-3">
        <ContactPanel
          candidateId={person.id}
          mobile={person.mobile}
          cooling={coolingWarning(state.lastContact, settings.contact_cooling_days)?.text ?? null}
          waAllowed={whatsappAllowed(state.consent)}
          defaultPurpose={purpose}
          pushId={pushId}
          label={`Contact ${person.name}`}
          templates={renderTemplates(settings, { name: person.name, company, position, hr_name: hrName }, purpose === "callback" ? "callback" : "bulk")}
        />
        {withCallback && (
          <CallbackBox
            candidateId={person.id}
            today={today}
            callback={state.callback ? { ...state.callback, dueText: formatDayIST(state.callback.dueOn) } : null}
            defaultDay={today}
            reason={null}
          />
        )}
      </div>
    </details>
  );
}
