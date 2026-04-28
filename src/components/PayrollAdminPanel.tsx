import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_PAYROLL_HOURLY_RATE,
  loadPayrollSettings,
  resetPayrollSettings,
  savePayrollSettings,
  type PayrollSettings,
} from "@/services/payroll";
import { Banknote, RefreshCw, Save } from "lucide-react";

export default function PayrollAdminPanel() {
  const [settings, setSettings] = useState<PayrollSettings>(() => loadPayrollSettings());
  const [rateInput, setRateInput] = useState(String(loadPayrollSettings().hourlyRate.toFixed(2)));
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const next = loadPayrollSettings();
    setSettings(next);
    setRateInput(next.hourlyRate.toFixed(2));
  }, []);

  const isDirty = useMemo(() => Number(rateInput) !== settings.hourlyRate, [rateInput, settings.hourlyRate]);

  const handleSave = () => {
    const nextRate = Number(rateInput);
    if (!Number.isFinite(nextRate) || nextRate <= 0) {
      setMessage("Enter a valid hourly rate greater than zero.");
      return;
    }

    setIsSaving(true);
    const result = savePayrollSettings(nextRate);
    setSettings(result.settings);
    setRateInput(result.settings.hourlyRate.toFixed(2));
    setMessage(
      result.persisted
        ? `Payroll rate saved at ${result.settings.hourlyRate.toFixed(2)} per hour.`
        : `Payroll rate updated in this session, but the browser storage is full so it could not be saved permanently.`
    );
    setIsSaving(false);
  };

  const handleReset = () => {
    setIsSaving(true);
    const result = resetPayrollSettings();
    setSettings(result.settings);
    setRateInput(result.settings.hourlyRate.toFixed(2));
    setMessage(
      result.persisted
        ? `Payroll rate reset to the default of ${DEFAULT_PAYROLL_HOURLY_RATE.toFixed(2)} per hour.`
        : `Payroll rate reset for this session, but the browser storage is full so it could not be saved permanently.`
    );
    setIsSaving(false);
  };

  return (
    <Card className="rounded-2xl border-emerald-200 bg-emerald-50/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-slate-950">
          <Banknote className="h-5 w-5" />
          Payroll
        </CardTitle>
        <CardDescription className="text-slate-700">
          Set the universal hourly rate used by payroll reports across the app.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl border border-emerald-200 bg-white p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <label className="text-sm font-medium text-slate-900">Hourly rate</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={rateInput}
                onChange={(event) => setRateInput(event.target.value)}
                className="mt-2 bg-white"
                placeholder="30.23"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={isSaving || !isDirty}>
                <Save className="mr-2 h-4 w-4" />
                Save Rate
              </Button>
              <Button variant="outline" onClick={handleReset} disabled={isSaving}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Default
              </Button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Badge className="bg-emerald-100 text-emerald-800">Current: R{settings.hourlyRate.toFixed(2)} / hour</Badge>
            <Badge className="bg-slate-100 text-slate-800">
              Last updated: {settings.updatedAt ? new Date(settings.updatedAt).toLocaleString("en-ZA") : "Not yet saved"}
            </Badge>
          </div>
        </div>

        {message && <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900">{message}</div>}
      </CardContent>
    </Card>
  );
}
