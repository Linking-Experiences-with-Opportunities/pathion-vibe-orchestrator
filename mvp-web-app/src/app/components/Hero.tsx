"use client";

import React from 'react';
import { Check, Linkedin, Instagram } from 'lucide-react';
import Link from 'next/link';
import { CodeMockup } from '@/components/ui/CodeMockup';
import { ShareButton } from '@/components/ShareButton';
import { initProfileNanoFromUserGesture } from '@/lib/profileNanoEditor';

export const Hero: React.FC = () => {

  return (
    <section className="relative flex min-h-screen w-full items-center justify-center overflow-hidden px-6 pt-32 pb-12 lg:px-8">

      {/* Absolute Logo Positioned Top-Left */}
      <div className="absolute top-6 left-6 lg:top-10 lg:left-10 z-20">
        <span className="text-xl font-extrabold italic tracking-tight text-white">
          LiLO Learning Platform
        </span>
      </div>

      <div className="mx-auto max-w-[1200px] w-full grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-16 items-center">

        {/* Left Column: Text Content */}
        <div className="flex flex-col justify-center space-y-8 z-10">
          <div className="space-y-6">
            <h1 className="text-5xl font-extrabold leading-[1.1] tracking-tight text-white sm:text-6xl lg:text-7xl">
              You’re Not Bad <br /> at Coding.
            </h1>
            <p className="text-2xl font-semibold text-white/90">
              You Just Need Stronger Fundamentals.
            </p>
            <p className="max-w-lg text-lg leading-relaxed text-[#a1a1aa]">
              A browser-based project lab that teaches you data structures by building them from scratch, so technical interview prep finally starts to make sense.
            </p>
          </div>

          {/* CTA Group */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6 pt-2">
            <Link
              href="/login"
              onClick={() => { initProfileNanoFromUserGesture(); }}
              className="h-14 px-8 rounded-lg bg-[#0085ff] text-white font-bold text-lg transition-all hover:bg-[#0070d9] hover:shadow-[0_0_20px_rgba(0,133,255,0.4)] focus:ring-2 focus:ring-[#0085ff] focus:ring-offset-2 focus:ring-offset-[#0a0a0f] flex items-center justify-center"
            >
              Start Learning
            </Link>

          </div>

          {/* Benefits List */}
          <ul className="space-y-4 pt-4 border-b border-[#262626] pb-8">
            {[
              "Learning-first. Free forever.",
              "Build real data structures from scratch",
              "Instant feedback in your browser",
              "Master DSA fundamentals before SWE interviews"
            ].map((benefit, index) => (
              <li key={index} className="flex items-center gap-3">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1bc20d]/20">
                  <Check className="h-4 w-4 text-[#1bc20d]" strokeWidth={3} />
                </div>
                <span className="text-base text-[#d4d4d8]">{benefit}</span>
              </li>
            ))}
          </ul>

          {/* Socials & Share */}
          <div className="flex items-center gap-6 text-[#71717a]">
            <ShareButton />

            <div className="h-5 w-px bg-[#262626]"></div>

            <div className="flex items-center gap-5">
              <a href="https://www.linkedin.com/company/linkedinorleftout-llc/?viewAsMember=true" target="_blank" rel="noopener noreferrer" className="hover:text-[#0077b5] transition-colors" aria-label="LinkedIn">
                <Linkedin className="h-5 w-5" />
              </a>
              <a href="https://www.instagram.com/linkedinorleftout?utm_source=ig_web_button_share_sheet&igsh=ZDNlZDc0MzIxNw==" target="_blank" rel="noopener noreferrer" className="hover:text-[#E1306C] transition-colors" aria-label="Instagram">
                <Instagram className="h-5 w-5" />
              </a>
            </div>
          </div>
        </div>

        {/* Right Column: Code Mockup */}
        <div className="relative w-full flex justify-center lg:justify-end z-10">
          <CodeMockup />
        </div>
      </div>

      {/* Background Glows matching mockup vibe */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-[#0085ff]/10 rounded-full blur-[120px] pointer-events-none mix-blend-screen" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-[#7c3aed]/10 rounded-full blur-[100px] pointer-events-none mix-blend-screen" />
    </section>
  );
};