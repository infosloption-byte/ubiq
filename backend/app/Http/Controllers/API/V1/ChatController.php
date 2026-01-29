<?php

namespace App\Http\Controllers\API\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use App\Models\ChatSession;
use App\Models\ChatMessage;
use Illuminate\Support\Facades\Validator;

class ChatController extends Controller
{
    // Get all chat sessions for the user
    public function index(Request $request)
    {
        $sessions = ChatSession::where('user_id', $request->user()->id)
            ->orderBy('updated_at', 'desc')
            ->get();

        return response()->json(['sessions' => $sessions]);
    }

    // Create a new chat session
    public function store(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'title' => 'nullable|string|max:255',
            'project_id' => 'nullable|exists:projects,id'
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()], 422);
        }

        $session = ChatSession::create([
            'user_id' => $request->user()->id,
            'project_id' => $request->project_id,
            'title' => $request->title ?? 'New Chat',
        ]);

        return response()->json(['session' => $session], 201);
    }

    // Get a single session
    public function show(Request $request, ChatSession $session)
    {
        if ($session->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        return response()->json(['session' => $session]);
    }

    // Delete a session
    public function destroy(Request $request, ChatSession $session)
    {
        if ($session->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        $session->delete();
        return response()->json(['message' => 'Session deleted']);
    }

    // Get messages for a session
    public function messages(Request $request, ChatSession $session)
    {
        if ($session->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        $messages = $session->messages()
            ->orderBy('created_at', 'asc')
            ->get();

        return response()->json(['messages' => $messages]);
    }

    // Save a new message to a session
    public function sendMessage(Request $request, ChatSession $session)
    {
        if ($session->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        $validator = Validator::make($request->all(), [
            'content' => 'required|string',
            'role' => 'sometimes|in:user,assistant,system'
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()], 422);
        }

        $message = $session->messages()->create([
            'role' => $request->role ?? 'user',
            'content' => $request->content,
            'tokens' => 0 // You can calculate tokens here if needed
        ]);

        // Update session timestamp
        $session->touch();

        return response()->json(['message' => $message]);
    }
}