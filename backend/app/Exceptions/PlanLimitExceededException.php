<?php

namespace App\Exceptions;

use Exception;

/**
 * Thrown by PlanGuard::authorize() when a guarded action is denied.
 * Carries structured data so controllers/frontend can render a specific
 * upgrade prompt instead of a generic error (see Phase C2).
 */
class PlanLimitExceededException extends Exception
{
    public function __construct(
        public readonly string $actionKey,
        public readonly string $reason,
        public readonly mixed $limitValue = null,
        public readonly mixed $currentUsage = null,
    ) {
        parent::__construct("Plan limit exceeded for action [{$actionKey}]: {$reason}");
    }

    public function toResponseArray(): array
    {
        return [
            'error' => 'plan_limit_exceeded',
            'action_key' => $this->actionKey,
            'reason' => $this->reason,
            'limit_value' => $this->limitValue,
            'current_usage' => $this->currentUsage,
        ];
    }
}
