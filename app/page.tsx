import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <div className="container mx-auto px-4 py-16">
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            GoalFlow
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            AI-Powered Goal Achievement with Minimal Friction
          </p>
          <div className="flex gap-4 justify-center">
            <Link href="/auth/signin">
              <Button size="lg">Sign In</Button>
            </Link>
            <Link href="/auth/signup">
              <Button size="lg" variant="outline">Get Started</Button>
            </Link>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle>🎯 Create Goals</CardTitle>
              <CardDescription>Minimal input, maximum clarity</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">
                Just describe your goal in a few words. Our AI extracts everything needed.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>🤖 AI-Generated Plans</CardTitle>
              <CardDescription>7-day actionable workflows</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">
                Get a structured 7-day plan with daily tasks, assessments, and fallbacks.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>📧 Email Check-ins</CardTitle>
              <CardDescription>Low friction daily progress</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">
                Daily emails with one-click check-ins. No login required.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
