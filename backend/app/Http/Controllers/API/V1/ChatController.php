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
        $user = $request->user();
        
        // Start Query
        $query = ChatSession::where('user_id', $user->id);

        // --- FILTERING LOGIC ---
        // If frontend sends ?project_id=123, return only those chats.
        // If frontend sends NOTHING, return only Global chats (where project_id is NULL).
        if ($request->has('project_id')) {
            $query->where('project_id', $request->input('project_id'));
        } else {
            $query->whereNull('project_id');
        }

        // Sort by newest first
        $sessions = $query->orderBy('updated_at', 'desc')->get();

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
            'project_id' => $request->project_id, // Can be null
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
            'tokens' => 0 
        ]);

        // Update session timestamp
        $session->touch();

        return response()->json(['message' => $message]);
    }

    /**
     * Auto-generate title for chat session
     */
    public function generateTitle(Request $request, ChatSession $session)
    {
        $prompt = $request->input('prompt');
        if (!$prompt) return response()->json(['message' => 'No prompt provided'], 400);

        $title = ucfirst(substr($prompt, 0, 40));
        if (strlen($prompt) > 40) $title .= '...';

        $session->update(['title' => $title]);

        return response()->json(['title' => $title]);
    }

    /**
     * Update chat session (e.g. rename title)
     */
    public function update(Request $request, ChatSession $session)
    {
        if ($request->user()->id !== $session->user_id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $validated = $request->validate([
            'title' => 'nullable|string|max:255',
        ]);

        $session->update($validated);

        return response()->json([
            'message' => 'Session updated',
            'session' => $session
        ]);
    }

    // Upload an attachment for a chat session
    public function uploadAttachment(Request $request, ChatSession $session)
    {
        if ($session->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        $request->validate([
            'file' => 'required|file|max:10240|mimes:jpeg,png,jpg,gif,webp,pdf,txt' // 10MB Limit
        ]);

        if ($request->hasFile('file')) {
            $file = $request->file('file');
            $path = $file->store('chat_attachments', 'public'); // Ensure 'public' disk is configured
            
            // Generate full URL
            $url = asset('storage/' . $path);

            return response()->json([
                'url' => $url,
                'name' => $file->getClientOriginalName(),
                'type' => $file->getClientMimeType()
            ]);
        }

        return response()->json(['error' => 'No file uploaded'], 400);
    }
}