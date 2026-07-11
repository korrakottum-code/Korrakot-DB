import { LogOut } from "lucide-react";

export default function LogoutButton() {
  return (
    <form action="/api/auth/logout" method="post">
      <button
        type="submit"
        className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors"
        title="ออกจากระบบ"
      >
        <LogOut className="w-4 h-4" />
        <span className="hidden sm:inline">ออกจากระบบ</span>
      </button>
    </form>
  );
}
