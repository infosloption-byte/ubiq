<?php

namespace App\Http\Controllers\API\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use App\Models\User;
use App\Models\Project;
use App\Models\UsageLog;
use Illuminate\Support\Facades\DB;

class AdminController extends Controller
{
    public function stats()
    {
        // 1. Visitors (Requires SiteVisit model & migration)
        $totalVisits = \App\Models\SiteVisit::count();
        $visitsToday = \App\Models\SiteVisit::whereDate('created_at', today())->count();

        // 2. Users
        $totalUsers = User::count();
        $newUsersToday = User::whereDate('created_at', today())->count();

        // 3. Conversion Rate
        $conversionRate = $totalVisits > 0 ? round(($totalUsers / $totalVisits) * 100, 2) : 0;

        // 4. Activity
        $activeUsers24h = UsageLog::where('created_at', '>=', now()->subDay())
            ->distinct('user_id')
            ->count('user_id');

        // 5. AI Stats
        $totalRequests = UsageLog::count();
        $failedRequests = UsageLog::where('success', false)->count();
        $errorRate = $totalRequests > 0 ? round(($failedRequests / $totalRequests) * 100, 1) : 0;
        $avgLatency = round(UsageLog::where('success', true)->avg('latency_ms') ?? 0, 0);

        return response()->json([
            // --- Traffic & Growth ---
            'total_users' => $totalUsers,
            'new_users_today' => $newUsersToday,
            'total_visits' => $totalVisits,
            'visits_today' => $visitsToday,
            'conversion_rate' => $conversionRate,
            
            // --- Health ---
            'active_users_24h' => $activeUsers24h,
            'error_rate' => $errorRate,
            'avg_latency' => $avgLatency,
            
            // --- Usage ---
            'total_projects' => Project::count(),
            'total_ai_requests' => $totalRequests,
            // Calculate approximate tokens (input + output)
            'total_tokens' => UsageLog::sum('tokens_input') + UsageLog::sum('tokens_output'),

            // --- MISSING PART 1: Subscription Tiers ---
            'tiers' => User::select('subscription_tier', DB::raw('count(*) as total'))
                ->groupBy('subscription_tier')
                ->pluck('total', 'subscription_tier'),

            // --- MISSING PART 2: Recent Users List ---
            'recent_users' => User::latest()->take(5)->get(),

            // --- Breakdown ---
            'ai_usage_breakdown' => UsageLog::select('model_used', DB::raw('count(*) as total'))
                ->groupBy('model_used')
                ->orderByDesc('total')
                ->get()
        ]);
    }

    public function getUsers()
    {
        return response()->json([
            'users' => User::withCount('projects')->latest()->paginate(20)
        ]);
    }

    public function deleteUser($id)
    {
        if (auth()->id() == $id) return response()->json(['error' => 'Cannot delete self'], 400);
        
        $user = User::findOrFail($id);
        $user->delete();
        return response()->json(['message' => 'User deleted']);
    }
}