// src/components/PricingSection.tsx
import React, { useState } from 'react';
import api from '../services/api';

export const PricingSection = () => {
  const [loading, setLoading] = useState(false);

  const handleSubscribe = async () => {
    setLoading(true);
    try {
      // 1. Call your Laravel backend to create the subscription
      const response = await api.post('/paypal/subscribe', {
        plan_type: 'pro_monthly'
      });

      // 2. Redirect the user to PayPal's approval URL
      if (response.data.approval_url) {
        window.location.href = response.data.approval_url;
      }
    } catch (error) {
      console.error("Subscription failed", error);
      alert("Could not initiate payment. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 border rounded-xl bg-card text-center max-w-sm mx-auto shadow-lg">
      <h2 className="text-2xl font-bold mb-2">Ubiq Pro</h2>
      <p className="text-gray-500 mb-6">Unlock unlimited projects and 20GB extra storage.</p>
      
      <div className="text-4xl font-bold mb-6">$10 <span className="text-sm font-normal text-gray-400">/ month</span></div>
      
      <ul className="text-left space-y-3 mb-8 text-sm">
        <li className="flex items-center">✅ All AI Models (Gemini, GPT-4)</li>
        <li className="flex items-center">✅ 20GB Cloud Storage</li>
        <li className="flex items-center">✅ Priority Support</li>
      </ul>

      <button 
        onClick={handleSubscribe}
        disabled={loading}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-semibold transition"
      >
        {loading ? "Redirecting to PayPal..." : "Subscribe Now"}
      </button>
    </div>
  );
};