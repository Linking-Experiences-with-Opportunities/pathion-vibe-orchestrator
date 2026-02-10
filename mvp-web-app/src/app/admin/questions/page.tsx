"use client";

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MoreHorizontal, PlusCircle, Search } from "lucide-react"
import { useEffect, useState } from "react"
import { QuestionData } from "@/components/CodeEditor/types"
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/fetchWithAuth"; // <--- IMPORT THIS

export default function QuestionsPage() {
  
  const searchParams = useSearchParams();
  const toastParam = searchParams.get("toast");

  useEffect(() => {
    if (toastParam === "created") {
      toast.success("Question created successfully!");
    }
  }, [toastParam]);

  const [questions, setQuestions] = useState<QuestionData[]>([])
  const [isLoading, setIsLoading] = useState(true) // Added loading state
  
  useEffect(() => {
    const fetchQuestions = async () => {
      setIsLoading(true);
      try {
        const url = `${process.env.NEXT_PUBLIC_BACKEND_API_URL}/admin/questions`;
        
        const response = await fetchWithAuth(url);
  
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Error fetching problem data: ${errorText}`);
        }
  
        const data = await response.json();
        console.log("Raw API Response:", data); // Check your console to see the structure

        // FIX: Handle both Raw Array and Object Wrapper formats
        let questionsList = [];
        
        if (Array.isArray(data)) {
          // Case 1: Backend returns raw array [...]
          questionsList = data;
        } else if (Array.isArray(data.problems)) {
          // Case 2: Backend returns { problems: [...] }
          questionsList = data.problems;
        } else if (Array.isArray(data.questions)) {
          // Case 3: Backend returns { questions: [...] }
          questionsList = data.questions;
        }
        
        setQuestions(questionsList);
      } catch (err) {
        console.error("Failed to fetch questions:", err);
        toast.error("Failed to load questions");
      } finally {
        setIsLoading(false);
      }
    };
  
    fetchQuestions();
  }, [])

  const getDifficultyColor = (difficulty: string) => {
    // Safety check for undefined difficulty
    if (!difficulty) return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";
    
    switch (difficulty.toLowerCase()) {
      case "easy":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300"
      case "medium":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300"
      case "hard":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300"
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300"
    }
  }

  return (
    <div className="flex min-h-screen w-full flex-col">
      <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Questions</h1>
          <Button asChild>
            <Link href="/admin/questions/new">
              <PlusCircle className="mr-2 h-4 w-4" />
              Create Question
            </Link>
          </Button>
        </div>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle>Question Library</CardTitle>
              <CardDescription>Manage your coding questions and exercises</CardDescription>
            </div>
            {/* Search/Filter UI ... */}
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Problem Number</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Difficulty</TableHead>
                  {/* Note: 'updatedAt' is currently not sent by the GetProblems handler. 
                      You will need to update handlers.go if you want this column to populate. */}
                  {/* <TableHead>Last Updated</TableHead> */}
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                   <TableRow>
                     <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                       Loading questions...
                     </TableCell>
                   </TableRow>
                ) : questions.length === 0 ? (
                   <TableRow>
                     <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                       No questions found. Create one to get started.
                     </TableCell>
                   </TableRow>
                ) : (
                  questions.map((question) => (
                    <TableRow key={question._id}> 
                      <TableCell>{question.questionNumber}</TableCell>
                      <TableCell className="font-medium">
                        <Link href={`/admin/questions/${question._id}`} className="hover:underline">
                          {question.title ?? "Untitled Question"}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={getDifficultyColor(question.difficulty)}>
                          {question.difficulty || "Unknown"}
                        </Badge>
                      </TableCell>
                      {/* <TableCell>{question.updatedAt}</TableCell> */}
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <MoreHorizontal className="h-4 w-4" />
                              <span className="sr-only">Actions</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem>
                              <Link href={`/admin/questions/${question._id}`}>Edit</Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem>Duplicate</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-red-600">Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}