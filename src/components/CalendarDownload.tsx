import { Download, Calendar } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function CalendarDownload() {
  const fileName = "2026-calendar.pdf";
  const filePath = `/${fileName}`;

  return (
    <Card className="rounded-2xl border-slate-700 bg-slate-900/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-white">
          <Calendar className="h-5 w-5 text-cyan-400" />
          2026 Calendar
        </CardTitle>
        <CardDescription className="text-slate-400">
          Download the 2026 calendar (Monday start, one sheet).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl border border-slate-700 bg-slate-950/40 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-medium text-white">{fileName}</div>
              <div className="text-sm text-slate-400">PDF file — downloadable</div>
            </div>
            <a href={filePath} download={fileName}>
              <Button>
                <Download className="mr-2 h-4 w-4" />
                Download
              </Button>
            </a>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
