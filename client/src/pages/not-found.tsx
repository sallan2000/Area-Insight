import { Link } from "wouter";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
      <div className="flex flex-col items-center justify-center p-8 bg-white rounded-2xl shadow-sm border border-border text-center max-w-md mx-4">
        <div className="bg-red-50 p-4 rounded-full mb-4">
          <AlertCircle className="h-12 w-12 text-red-500" />
        </div>
        <h1 className="text-4xl font-display font-bold text-foreground mb-2">404</h1>
        <p className="text-lg text-muted-foreground mb-6">
          Oops! The page you're looking for doesn't exist.
        </p>

        <Link href="/" className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-xl text-white bg-primary hover:bg-primary/90 transition-all duration-200 shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30">
          Return Home
        </Link>
      </div>
    </div>
  );
}
