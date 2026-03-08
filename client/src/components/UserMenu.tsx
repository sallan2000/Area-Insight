import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { LogIn, LogOut, User, History } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu() {
  const { user, isLoading, isAuthenticated, logout } = useAuth();

  if (isLoading) {
    return <div className="w-8 h-8 rounded-full bg-muted animate-pulse" />;
  }

  if (!isAuthenticated || !user) {
    return (
      <a href="/api/login" data-testid="button-login">
        <Button variant="outline" size="sm" className="gap-2">
          <LogIn className="h-4 w-4" />
          Log in
        </Button>
      </a>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2" data-testid="button-user-menu">
          {user.profileImageUrl ? (
            <img
              src={user.profileImageUrl}
              alt={user.firstName || "User"}
              className="w-6 h-6 rounded-full object-cover"
            />
          ) : (
            <User className="h-4 w-4" />
          )}
          <span className="hidden sm:inline text-sm font-medium">
            {user.firstName || "Account"}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <div className="px-2 py-1.5">
          <p className="text-sm font-medium" data-testid="text-user-name">
            {[user.firstName, user.lastName].filter(Boolean).join(" ") || "User"}
          </p>
          {user.email && (
            <p className="text-xs text-muted-foreground" data-testid="text-user-email">{user.email}</p>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="/history" className="flex items-center gap-2 cursor-pointer" data-testid="link-history">
            <History className="h-4 w-4" />
            My Searches
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => logout()}
          className="text-destructive focus:text-destructive cursor-pointer"
          data-testid="button-logout"
        >
          <LogOut className="h-4 w-4 mr-2" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
