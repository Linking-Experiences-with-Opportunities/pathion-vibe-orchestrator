import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import CodeEditor, { ProblemWindowLanguageOption } from "@/components/CodeEditor/CodeEditor";

interface DriverCodeTemplateProps {
    driverCode: string;
    selectedLanguage: ProblemWindowLanguageOption;
    setDriverCode: (value: string) => void;
}

export default function DriverCodeTemplate({ driverCode, selectedLanguage, setDriverCode }: DriverCodeTemplateProps) {
    return (
        <Card className="lg:col-span-3">
            <CardContent>
                <CardHeader>
                    <div className="flex space-y-2 justify-between ">
                        <div className="space-y-2">
                            <CardTitle>Driver Code (Hidden)</CardTitle>
                            <CardDescription>
                                Hidden logic to bridge test inputs to the student&apos;s code (e.g., parsing LeetCode-style input arrays).
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <div className="h-[400px] border rounded-xl p-5 flex ">
                    <div className="flex-1">
                        <CodeEditor
                            value={driverCode}
                            language={selectedLanguage}
                            onChange={(value) => setDriverCode(value ?? driverCode)}
                        />
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
