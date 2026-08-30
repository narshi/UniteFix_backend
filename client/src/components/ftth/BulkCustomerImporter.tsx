/**
 * Universal Dynamic Excel/CSV Customer Roster Importer
 *
 * Supports arbitrary spreadsheet templates from any ISP / broadband billing software:
 * 1. Upload .xlsx, .xls, .csv
 * 2. Smart auto-detection of column headers (Fuzzy matching)
 * 3. Interactive column mapper with live 3-row data preview
 * 4. Validation & atomic bulk import with auto-linking to registered UniteFix users
 */

import React, { useState, useMemo } from "react";
import * as XLSX from "xlsx";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, ArrowRight,
  RefreshCw, Check, Sparkles, AlertCircle, Users,
} from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  operatorId?: number; // Optional if operator portal, required if staff admin
  operatorName?: string;
  isStaffAdmin?: boolean;
  onSuccess?: () => void;
}

interface TargetField {
  key: string;
  label: string;
  required: boolean;
  keywords: string[];
  description: string;
}

const TARGET_FIELDS: TargetField[] = [
  {
    key: "ispConnectionId",
    label: "ISP Connection ID / Username",
    required: true,
    keywords: ["username", "user_id", "userid", "user id", "account_no", "accountno", "account no", "account", "id", "login", "cid", "subscriber_id", "subscriber id"],
    description: "Unique broadband identifier in ISP billing / OLT software",
  },
  {
    key: "customerName",
    label: "Customer Full Name",
    required: true,
    keywords: ["full name", "fullname", "customer_name", "customername", "customer name", "name", "subscriber_name", "subscriber name", "subscriber", "client name", "client"],
    description: "Name of the customer or business",
  },
  {
    key: "customerPhone",
    label: "Customer Phone / Mobile",
    required: true,
    keywords: ["mobile", "phone", "phone_no", "phoneno", "phone no", "mobile_no", "mobileno", "contact", "contact_no", "cell", "phone number", "mobile number"],
    description: "10-digit mobile number for login auto-linking",
  },
  {
    key: "customerEmail",
    label: "Customer Email",
    required: false,
    keywords: ["email_id", "emailid", "email id", "email", "mail", "email_address", "email address"],
    description: "Customer email address for receipts",
  },
  {
    key: "installationAddress",
    label: "Installation Address",
    required: false,
    keywords: ["address", "installation_address", "installation address", "location", "area", "premises", "street"],
    description: "Physical line installation address",
  },
  {
    key: "validTill",
    label: "Expiry / Validity Date",
    required: false,
    keywords: ["valid_till", "validtill", "valid till", "expiry_date", "expirydate", "expiry date", "expiry", "expiration", "renewal_date", "due_date"],
    description: "Current plan expiration date (if available)",
  },
];

export function BulkCustomerImporter({
  open,
  onOpenChange,
  operatorId,
  operatorName,
  isStaffAdmin = false,
  onSuccess,
}: Props) {
  const { toast } = useToast();

  const [step, setStep] = useState<"upload" | "map" | "importing" | "result">("upload");
  const [fileName, setFileName] = useState<string>("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Array<Record<string, any>>>([]);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [importResult, setImportResult] = useState<{
    totalRows: number;
    inserted: number;
    updated: number;
    autoLinkedUsers: number;
    errors: Array<{ row: number; error: string }>;
  } | null>(null);

  const reset = () => {
    setStep("upload");
    setFileName("");
    setHeaders([]);
    setRawRows([]);
    setMappings({});
    setImportResult(null);
  };

  const handleClose = () => {
    reset();
    onOpenChange(false);
  };

  // Smart header auto-detection
  const autoDetectMappings = (extractedHeaders: string[]) => {
    const initialMap: Record<string, string> = {};

    TARGET_FIELDS.forEach(field => {
      const match = extractedHeaders.find(h => {
        const clean = h.trim().toLowerCase().replace(/[-_]/g, " ");
        return field.keywords.some(k => clean === k || clean.includes(k));
      });
      if (match) {
        initialMap[field.key] = match;
      }
    });

    setMappings(initialMap);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();

    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: "binary", cellDates: true });
        const sheetName = wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json<Record<string, any>>(ws);

        if (data.length === 0) {
          toast({
            title: "Empty Spreadsheet",
            description: "The uploaded file does not contain any data rows.",
            variant: "destructive",
          });
          return;
        }

        const extractedHeaders = Object.keys(data[0] || {});
        setHeaders(extractedHeaders);
        setRawRows(data);
        autoDetectMappings(extractedHeaders);
        setStep("map");
      } catch (err: any) {
        toast({
          title: "File Parse Error",
          description: "Unable to read spreadsheet: " + err.message,
          variant: "destructive",
        });
      }
    };

    reader.readAsBinaryString(file);
  };

  // Check if required fields are mapped
  const canProceed = useMemo(() => {
    return (
      !!mappings.ispConnectionId &&
      !!mappings.customerName &&
      !!mappings.customerPhone
    );
  }, [mappings]);

  // Preview of mapped data for first 3 rows
  const previewRows = useMemo(() => {
    return rawRows.slice(0, 3).map((row, idx) => {
      const rawIspId = mappings.ispConnectionId ? row[mappings.ispConnectionId] : "";
      const rawName = mappings.customerName ? row[mappings.customerName] : "";
      const rawPhone = mappings.customerPhone ? row[mappings.customerPhone] : "";
      const cleanPhone = String(rawPhone || "").replace(/\D/g, "").slice(-10);
      const rawEmail = mappings.customerEmail ? row[mappings.customerEmail] : "";
      const rawAddr = mappings.installationAddress ? row[mappings.installationAddress] : "";

      return {
        id: idx + 1,
        ispId: String(rawIspId || "—"),
        name: String(rawName || "—"),
        phone: cleanPhone ? `+91 ${cleanPhone}` : "—",
        email: String(rawEmail || "—"),
        address: String(rawAddr || "—"),
      };
    });
  }, [rawRows, mappings]);

  const executeImport = async () => {
    if (!canProceed) return;
    setStep("importing");

    try {
      const endpoint = isStaffAdmin
        ? "/api/admin/ftth/customers/bulk-import"
        : "/api/ftth/admin/customers/bulk-import";

      const payload = {
        operatorId,
        mappings,
        rows: rawRows,
      };

      const res = await apiRequest("POST", endpoint, payload);
      setImportResult(res.data);
      setStep("result");
      onSuccess?.();
      toast({
        title: "Import Completed",
        description: `Successfully processed ${res.data.totalRows} customer accounts.`,
      });
    } catch (err: any) {
      setStep("map");
      toast({
        title: "Import Failed",
        description: err.message || "Failed to process customer roster import.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl bg-[hsl(222,47%,11%)] text-white border-[rgba(255,255,255,0.12)] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-indigo-400" />
            Import Customer Roster
            {operatorName && <span className="text-sm font-normal text-[hsl(215,20%,65%)]">({operatorName})</span>}
          </DialogTitle>
          <DialogDescription className="text-sm text-[hsl(215,20%,65%)]">
            Upload any Excel (.xlsx, .xls) or CSV file. Match your sheet's column names to UniteFix fields.
          </DialogDescription>
        </DialogHeader>

        {/* STEP 1: UPLOAD */}
        {step === "upload" && (
          <div className="py-6 space-y-6">
            <label className="border-2 border-dashed border-[rgba(255,255,255,0.18)] hover:border-indigo-400/60 rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer transition-colors bg-[rgba(255,255,255,0.02)] group">
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleFileUpload}
              />
              <div className="w-14 h-14 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-400 group-hover:scale-110 transition-transform mb-3">
                <Upload className="w-7 h-7" />
              </div>
              <p className="text-base font-semibold text-white">Click or drag & drop spreadsheet</p>
              <p className="text-xs text-[hsl(215,20%,60%)] mt-1">Supports .xlsx, .xls, and .csv files</p>
            </label>

            <div className="bg-[rgba(255,255,255,0.04)] rounded-xl p-4 border border-[rgba(255,255,255,0.08)]">
              <p className="text-xs font-semibold text-indigo-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Universal Compatibility
              </p>
              <p className="text-xs text-[hsl(215,20%,65%)] leading-relaxed">
                You do not need to rename your columns to a specific format. Our smart importer automatically detects your column headers and lets you map them with a live preview.
              </p>
            </div>
          </div>
        )}

        {/* STEP 2: COLUMN MAPPING & PREVIEW */}
        {step === "map" && (
          <div className="py-4 space-y-6">
            <div className="flex items-center justify-between bg-indigo-500/10 border border-indigo-500/20 rounded-xl px-4 py-3">
              <div className="flex items-center gap-2.5">
                <FileSpreadsheet className="w-4 h-4 text-indigo-400" />
                <span className="text-sm font-medium text-white">{fileName}</span>
              </div>
              <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30">
                {rawRows.length} Rows Detected
              </Badge>
            </div>

            {/* Field Matcher Grid */}
            <div className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[hsl(215,20%,60%)]">
                Match Spreadsheet Columns
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {TARGET_FIELDS.map(field => {
                  const currentMapped = mappings[field.key] ?? "";
                  const isMapped = !!currentMapped;
                  const sampleVal = isMapped && rawRows[0] ? String(rawRows[0][currentMapped] ?? "") : "";

                  return (
                    <div
                      key={field.key}
                      className={`p-3.5 rounded-xl border transition-all ${
                        field.required && !isMapped
                          ? "border-amber-500/40 bg-amber-500/5"
                          : "border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)]"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <Label className="text-xs font-medium text-white flex items-center gap-1">
                          {field.label}
                          {field.required && <span className="text-red-400">*</span>}
                        </Label>
                        {isMapped && (
                          <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-0.5">
                            <Check className="w-3 h-3" /> Matched
                          </span>
                        )}
                      </div>

                      <Select
                        value={currentMapped || "none"}
                        onValueChange={(val) => {
                          setMappings(prev => ({
                            ...prev,
                            [field.key]: val === "none" ? "" : val,
                          }));
                        }}
                      >
                        <SelectTrigger className="h-9 bg-[hsl(222,47%,14%)] border-[rgba(255,255,255,0.12)] text-xs text-white">
                          <SelectValue placeholder="Select column…" />
                        </SelectTrigger>
                        <SelectContent className="bg-[hsl(222,47%,14%)] border-[rgba(255,255,255,0.12)] text-white">
                          <SelectItem value="none" className="text-xs text-[hsl(215,20%,65%)]">
                            -- None / Ignore --
                          </SelectItem>
                          {headers.map(h => (
                            <SelectItem key={h} value={h} className="text-xs">
                              {h}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {sampleVal && (
                        <p className="text-[11px] text-[hsl(215,20%,55%)] mt-1.5 truncate">
                          Row 1 sample: <span className="text-white font-mono">{sampleVal}</span>
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Live 3-Row Preview Table */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[hsl(215,20%,60%)]">
                Live Data Preview (First 3 Rows)
              </h3>
              <div className="border border-[rgba(255,255,255,0.08)] rounded-xl overflow-x-auto bg-[rgba(255,255,255,0.01)]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[rgba(255,255,255,0.04)] text-[hsl(215,20%,65%)] border-b border-[rgba(255,255,255,0.08)]">
                    <tr>
                      <th className="p-2.5 font-medium">#</th>
                      <th className="p-2.5 font-medium">ISP ID</th>
                      <th className="p-2.5 font-medium">Name</th>
                      <th className="p-2.5 font-medium">Phone</th>
                      <th className="p-2.5 font-medium">Email</th>
                      <th className="p-2.5 font-medium">Address</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">
                    {previewRows.map(row => (
                      <tr key={row.id}>
                        <td className="p-2.5 text-[hsl(215,20%,50%)]">{row.id}</td>
                        <td className="p-2.5 font-mono text-indigo-300 font-semibold">{row.ispId}</td>
                        <td className="p-2.5 text-white font-medium">{row.name}</td>
                        <td className="p-2.5 font-mono text-[hsl(215,20%,80%)]">{row.phone}</td>
                        <td className="p-2.5 text-[hsl(215,20%,65%)] truncate max-w-[120px]">{row.email}</td>
                        <td className="p-2.5 text-[hsl(215,20%,65%)] truncate max-w-[120px]">{row.address}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: IMPORTING LOADER */}
        {step === "importing" && (
          <div className="py-16 flex flex-col items-center justify-center space-y-4">
            <RefreshCw className="w-10 h-10 text-indigo-400 animate-spin" />
            <h3 className="text-base font-semibold text-white">Importing Customer Roster…</h3>
            <p className="text-xs text-[hsl(215,20%,65%)] max-w-sm text-center">
              Sanitizing records, updating broadband accounts, and auto-linking registered UniteFix members.
            </p>
          </div>
        )}

        {/* STEP 4: SUCCESS SUMMARY REPORT */}
        {step === "result" && importResult && (
          <div className="py-6 space-y-6">
            <div className="flex flex-col items-center justify-center text-center space-y-2">
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white">Roster Imported Successfully</h3>
              <p className="text-xs text-[hsl(215,20%,65%)]">
                All accounts are active and ready for instant recharge in the mobile app.
              </p>
            </div>

            {/* Metrics Breakdown Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-xl bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.08)] text-center">
                <p className="text-xs text-[hsl(215,20%,60%)]">Total Rows</p>
                <p className="text-xl font-bold text-white mt-1">{importResult.totalRows}</p>
              </div>
              <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center">
                <p className="text-xs text-emerald-300">New Inserted</p>
                <p className="text-xl font-bold text-emerald-400 mt-1">{importResult.inserted}</p>
              </div>
              <div className="p-3.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-center">
                <p className="text-xs text-indigo-300">Updated</p>
                <p className="text-xl font-bold text-indigo-400 mt-1">{importResult.updated}</p>
              </div>
              <div className="p-3.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-center">
                <p className="text-xs text-purple-300">Auto-Linked</p>
                <p className="text-xl font-bold text-purple-400 mt-1 flex items-center justify-center gap-1">
                  <Users className="w-4 h-4" />
                  {importResult.autoLinkedUsers}
                </p>
              </div>
            </div>

            {/* Error / Skipped rows if any */}
            {importResult.errors.length > 0 && (
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-2">
                <div className="flex items-center gap-2 text-amber-300 text-xs font-semibold">
                  <AlertTriangle className="w-4 h-4" />
                  {importResult.errors.length} Row(s) Skipped Due to Missing ISP ID
                </div>
                <ul className="text-[11px] text-[hsl(215,20%,65%)] list-disc pl-4 space-y-0.5 max-h-24 overflow-y-auto">
                  {importResult.errors.map((e, idx) => (
                    <li key={idx}>Row {e.row}: {e.error}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex items-center justify-between sm:justify-between border-t border-[rgba(255,255,255,0.08)] pt-4">
          {step === "map" && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep("upload")}
                className="border-[rgba(255,255,255,0.12)] text-white hover:bg-[rgba(255,255,255,0.05)]"
              >
                Choose Another File
              </Button>
              <Button
                size="sm"
                disabled={!canProceed}
                onClick={executeImport}
                className="bg-indigo-600 hover:bg-indigo-500 text-white gap-1.5"
              >
                Confirm & Import {rawRows.length} Records
                <ArrowRight className="w-4 h-4" />
              </Button>
            </>
          )}

          {step === "result" && (
            <Button
              size="sm"
              onClick={handleClose}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
