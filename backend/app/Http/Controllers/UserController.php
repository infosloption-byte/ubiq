<?php
// ============================================================
// File: app/Http/Controllers/UserController.php
// ============================================================

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use App\Models\UsageLog;
use Carbon\Carbon;

class UserController extends Controller
{
    public function profile(Request $request)
    {
        $user = $request->user();
        
        return response()->json([
            'profile' => [
                'id' => $user->id,
                'username' => $user->username,
                'email' => $user->email,
                'subscription_tier' => $user->subscription_tier,
                'subscription_status' => $user->subscription_status, // Add this
                'api_key' => $user->api_key,
                'created_at' => $user->created_at,
            ]
        ]);
    }
    
    public function updateProfile(Request $request)
    {
        $user = $request->user();
        
        $validator = Validator::make($request->all(), [
            'username' => 'sometimes|string|max:100|unique:users,username,' . $user->id,
            'email' => 'sometimes|email|max:191|unique:users,email,' . $user->id,
        ]);
        
        if ($validator->fails()) {
            return response()->json([
                'error' => 'Validation failed',
                'messages' => $validator->errors()
            ], 422);
        }
        
        if ($request->has('username')) {
            $user->username = $request->username;
        }
        
        if ($request->has('email')) {
            $user->email = $request->email;
            $user->email_verified_at = null; // Reset verification
        }
        
        $user->save();
        
        return response()->json([
            'message' => 'Profile updated successfully',
            'profile' => $user
        ]);
    }
    
    public function preferences(Request $request)
    {
        $preferences = $request->user()->preferences;
        
        if (!$preferences) {
            return response()->json([
                'error' => 'Preferences not found'
            ], 404);
        }
        
        return response()->json([
            'preferences' => [
                'preferred_model' => $preferences->preferred_model,
                'theme' => $preferences->theme,
                'editor_settings' => json_decode($preferences->editor_settings),
                'auto_complete' => (bool) $preferences->auto_complete,
                'code_suggestions' => (bool) $preferences->code_suggestions,
            ]
        ]);
    }
    
    public function updatePreferences(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'preferred_model' => 'sometimes|string|max:100',
            'theme' => 'sometimes|string|in:dark,light',
            'editor_settings' => 'sometimes|array',
            'auto_complete' => 'sometimes|boolean',
            'code_suggestions' => 'sometimes|boolean',
        ]);
        
        if ($validator->fails()) {
            return response()->json([
                'error' => 'Validation failed',
                'messages' => $validator->errors()
            ], 422);
        }
        
        $preferences = $request->user()->preferences;
        
        if ($request->has('preferred_model')) {
            $preferences->preferred_model = $request->preferred_model;
        }
        
        if ($request->has('theme')) {
            $preferences->theme = $request->theme;
        }
        
        if ($request->has('editor_settings')) {
            $preferences->editor_settings = json_encode($request->editor_settings);
        }
        
        if ($request->has('auto_complete')) {
            $preferences->auto_complete = $request->auto_complete;
        }
        
        if ($request->has('code_suggestions')) {
            $preferences->code_suggestions = $request->code_suggestions;
        }
        
        $preferences->save();
        
        return response()->json([
            'message' => 'Preferences updated successfully',
            'preferences' => [
                'preferred_model' => $preferences->preferred_model,
                'theme' => $preferences->theme,
                'editor_settings' => json_decode($preferences->editor_settings),
                'auto_complete' => (bool) $preferences->auto_complete,
                'code_suggestions' => (bool) $preferences->code_suggestions,
            ]
        ]);
    }
    
    public function usage(Request $request)
    {
        $user = $request->user();
        $days = $request->input('days', 7);
        
        $usage = UsageLog::where('user_id', $user->id)
            ->where('created_at', '>=', Carbon::now()->subDays($days))
            ->get();
        
        $summary = [
            'total_requests' => $usage->count(),
            'successful_requests' => $usage->where('success', true)->count(),
            'failed_requests' => $usage->where('success', false)->count(),
            'total_tokens' => $usage->sum('tokens_output'),
            'avg_latency_ms' => round($usage->avg('latency_ms'), 2),
            'by_type' => $usage->groupBy('request_type')->map(function ($group) {
                return $group->count();
            }),
            'by_model' => $usage->groupBy('model_used')->map(function ($group) {
                return $group->count();
            }),
        ];
        
        return response()->json([
            'summary' => $summary,
            'recent_logs' => $usage->take(20)->values()
        ]);
    }
    
    public function stats(Request $request)
    {
        $user = $request->user();
        
        return response()->json([
            'stats' => [
                'total_projects' => $user->projects()->count(),
                'total_files' => $user->projects()->withCount('files')->get()->sum('files_count'),
                'total_chats' => $user->chatSessions()->count(),
                'subscription_tier' => $user->subscription_tier,
                'subscription_status' => $user->subscription_status,
                'member_since' => $user->created_at->diffForHumans(),
            ]
        ]);
    }
}

