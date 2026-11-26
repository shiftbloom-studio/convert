// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 shiftbloom studio and contributors
// Copy and metadata for the start page and the format landing pages.
// Each format page loads the same converter with a preset target and adds its own article.

import type { Home, Page } from "./types.ts";

export const REPO = "https://github.com/shiftbloom-studio/convert";

export const HOME: Home = {
  slug: "",
  title: "Free file converter for images, video and audio · convert.",
  desc: "Turn HEIC photos into JPGs and MOV clips into MP4s. Images and video go through Cloudflare and are deleted after 24 hours. Everything else is converted inside your browser and never uploaded.",
  h1: "Your phone shot it in HEIC. The form wants a JPG.",
  lead: "Drop the file here and pick a format. Images up to 20 MB and videos up to 200 MB are converted on Cloudflare and deleted after a day. GIFs, WebM and audio are made by ffmpeg inside this tab, so those files never get uploaded.",
  example: { name: "IMG_2041.HEIC", to: "jpg", a: "3.1 MB", b: "840 KB", where: "cloud" },
};

export const FAQ: [question: string, answer: string][] = [
  ["Are my files stored?", "Images are not. Cloudflare converts them and sends them straight back. Videos and their results sit in Cloudflare R2 for at most 24 hours and are then deleted automatically."],
  ["Which formats never leave my device?", "WebM, GIF, MP3, WAV and OGG are made by ffmpeg.wasm in your browser. If you switch to “In your browser” before converting, images and MP4 videos stay on your device as well."],
  ["How big can a file be?", "On Cloudflare, images can be up to 20 MB and videos up to 200 MB and ten minutes long. In your browser there is no fixed limit, only the memory of your device."],
  ["Do I need an account?", "No. convert sets no cookies and doesn't count visitors. Before each video job, Cloudflare Turnstile checks that a person is clicking."],
  ["What does it cost?", "Nothing. To keep the bill predictable there is a daily allowance of __IMG_DAY__ images and __JOB_DAY__ videos per connection."],
];

export const PAGES: Page[] = [
  {
    slug: "heic-to-jpg",
    link: "HEIC to JPG",
    title: "Convert HEIC to JPG for free · convert.",
    desc: "Turn iPhone photos from HEIC into JPG so every upload form accepts them. Up to 20 MB per image, no account, nothing is stored.",
    h1: "Convert HEIC to JPG.",
    lead: "Your iPhone saves photos as HEIC, and plenty of forms and older programs only take JPG. Drop the photo here, Cloudflare converts it and you download the JPG right away.",
    example: { name: "IMG_2041.HEIC", to: "jpg", a: "1.8 MB", b: "2.6 MB", where: "cloud" },
    preset: { kind: "image", target: "jpeg", mode: "cloud" },
    h2: "Why your iPhone saves HEIC",
    body: [
      "Since iOS 11 the camera saves photos as HEIC. At the same quality it needs roughly half the space of a JPG, which is handy on a phone. Once the photo has to go into a job portal or an older Windows program, the format often gets in the way.",
      "convert sends the image to Cloudflare Images. It is decoded there, encoded again as JPG and sent straight back to your browser. Nothing is kept. The JPG usually ends up a bit larger than the HEIC, because JPG compresses less efficiently. Lower the quality or set a maximum width to bring the size down again. A width of 2000 pixels is enough for almost any form.",
      "The limit is 20 MB per image, and a normal iPhone photo has between 1 and 4 MB. You can drop a whole batch at once. By default Cloudflare leaves out location data and camera details and only keeps a copyright notice if the photo has one, so the result is fine to share.",
    ],
  },
  {
    slug: "mov-to-mp4",
    link: "MOV to MP4",
    title: "Convert MOV to MP4 for free · convert.",
    desc: "Turn iPhone and camera videos from MOV into MP4 with H.264. Up to 200 MB and ten minutes on Cloudflare, larger files right in your browser.",
    h1: "Convert MOV to MP4.",
    lead: "MOV files come from iPhones and cameras and don't play everywhere. As an MP4 with H.264 the same video runs on nearly every device and in every messenger.",
    example: { name: "IMG_3318.MOV", to: "mp4", a: "84 MB", b: "31 MB", where: "cloud" },
    preset: { kind: "video", target: "mp4", mode: "cloud" },
    h2: "What happens to the video",
    body: [
      "MOV is a container made by Apple. On an iPhone it usually holds HEVC, a codec that many Windows PCs and older smart TVs can't play. convert uploads the video to Cloudflare Stream, where it is encoded again as H.264 with AAC sound. That combination plays practically anywhere.",
      "As soon as the MP4 is ready we copy it into Cloudflare R2 and delete the video from Stream. Your download stays available for 24 hours and is removed automatically after that. You don't need an account. Before the upload, Cloudflare Turnstile only checks briefly that a person is clicking.",
      "On Cloudflare, videos can be up to 200 MB and ten minutes long. For longer or larger recordings, switch to “In your browser” above. ffmpeg then runs on your own device and nothing is uploaded. It takes longer than the cloud, depending on your computer several times the length of the video.",
    ],
  },
  {
    slug: "webp-to-png",
    link: "WebP to PNG",
    title: "Convert WebP to PNG for free · convert.",
    desc: "Turn WebP images saved from the web into PNG so every program can open them. Up to 20 MB per image, no account, nothing is stored.",
    h1: "Convert WebP to PNG.",
    lead: "You saved an image from a website and it ends in .webp. Here it becomes a PNG that any image program opens.",
    example: { name: "banner.webp", to: "png", a: "180 KB", b: "1.2 MB", where: "cloud" },
    preset: { kind: "image", target: "png", mode: "cloud" },
    h2: "Why websites serve WebP",
    body: [
      "WebP is the format websites use to load faster. A WebP is often a third smaller than a comparable JPG. When you save one and want to reuse it in Word or a slide deck, that doesn't always work.",
      "PNG is lossless. The new image looks exactly like the WebP, but it gets bigger, especially for photos. Transparent areas are kept. Animated WebP files turn into a single still frame here. For animations, GIF or MP4 is the better target.",
      "Cloudflare Images does the conversion. The image goes there, comes back as PNG and isn't stored anywhere. Each image can be up to 20 MB. If you need a smaller result, enter a maximum width and the aspect ratio stays the same. If you'd rather not upload the image at all, switch to “In your browser”, where ffmpeg makes the PNG on your own device.",
    ],
  },
  {
    slug: "png-to-webp",
    link: "PNG to WebP",
    title: "Convert PNG to WebP for free · convert.",
    desc: "Turn PNG images and screenshots into WebP and cut the file size for your website. With a quality setting and maximum width, no account.",
    h1: "Convert PNG to WebP.",
    lead: "A screenshot saved as PNG easily weighs 2 MB. As WebP it is often a few hundred kilobytes, and nobody on your website will see the difference.",
    example: { name: "screenshot.png", to: "webp", a: "2.4 MB", b: "310 KB", where: "cloud" },
    preset: { kind: "image", target: "webp", mode: "cloud" },
    h2: "When WebP is worth it",
    body: [
      "For images on a website, WebP almost always beats PNG. Every current browser shows it, and smaller images load faster. You notice it most on phones and in the Core Web Vitals that Google uses to rate pages.",
      "The quality setting decides how hard the image is compressed. 85 is a good start. For screenshots with a lot of text you can go up to 90 so the letters stay sharp. Transparency is kept. If the image is wider than it will ever be shown on the page, enter a maximum width such as 1600 pixels.",
      "PNG still makes a good archive format because it is lossless. Keep the original and use WebP for delivery. Cloudflare Images converts the picture and sends it straight back without storing it. The limit is 20 MB per file.",
    ],
  },
  {
    slug: "video-to-gif",
    link: "Video to GIF",
    title: "Convert video to GIF in your browser · convert.",
    desc: "Make a GIF from a short video without uploading it. ffmpeg runs in your browser and builds a colour palette for every GIF.",
    h1: "Convert a video to GIF.",
    lead: "For Slack, a README or a forum post a GIF is often easier than a video. Here it is made inside your browser, so the video never leaves your device.",
    example: { name: "demo.mp4", to: "gif", a: "12 MB", b: "3.8 MB", where: "local" },
    preset: { kind: "video", target: "gif", mode: "local" },
    h2: "How the GIF is made",
    body: [
      "The first time, convert loads ffmpeg as WebAssembly into your browser, which is about 30 MB once. After that the video is read locally, reduced to 12 frames per second and scaled to 480 pixels wide. ffmpeg first works out a colour palette from the whole clip and then applies it, so gradients and skin tones look much cleaner than with a standard palette.",
      "GIF is an old format that stores every frame on its own. That is why a GIF is often larger than the video it came from. Keep the clip short, a few seconds is usually enough. If you need more width, enter it above. Every time you double the width, the file grows roughly four times.",
      "Because everything runs on your computer there is no fixed size limit, only the memory of your device. On a laptop that is rarely a problem. On a phone, videos above 200 MB tend to fail.",
    ],
  },
  {
    slug: "mp4-to-mp3",
    link: "MP4 to MP3",
    title: "Convert MP4 to MP3 without uploading · convert.",
    desc: "Save the sound of an MP4 video as MP3. Runs entirely in your browser with ffmpeg, the video is never uploaded.",
    h1: "Convert MP4 to MP3.",
    lead: "Sometimes you only need the sound of a video, like a talk or a voice recording. convert pulls out the audio track and saves it as MP3 while the video stays on your device.",
    example: { name: "talk.mp4", to: "mp3", a: "240 MB", b: "38 MB", where: "local" },
    preset: { kind: "video", target: "mp3", mode: "local" },
    h2: "How the video becomes an MP3",
    body: [
      "ffmpeg runs as WebAssembly in your browser. It reads the audio track, drops the picture and encodes the sound with LAME as a variable bitrate MP3 at level 2. That averages around 190 kbit/s and sounds good for speech and music alike. One hour of audio comes out at roughly 85 MB.",
      "Since nothing is uploaded, this also works for confidential recordings such as internal meetings. The file is processed in your browser's memory and goes straight into your downloads folder.",
      "If you are in a hurry and the video is under 200 MB, switch to “On Cloudflare” above. Cloudflare then makes an M4A file with AAC sound, which every current device plays. We delete the copy at Cloudflare as soon as the result is ready, and the download itself after 24 hours.",
    ],
  },
  {
    slug: "jpg-to-avif",
    link: "JPG to AVIF",
    title: "Convert JPG to AVIF for free · convert.",
    desc: "Turn JPG photos into AVIF and often halve their size for your website. With a quality setting, up to 20 MB per image, no account.",
    h1: "Convert JPG to AVIF.",
    lead: "AVIF is the smallest image format browsers can show today. A photo that weighs 1.2 MB as JPG often needs less than half of that as AVIF.",
    example: { name: "hero.jpg", to: "avif", a: "1.2 MB", b: "420 KB", where: "cloud" },
    preset: { kind: "image", target: "avif", mode: "cloud" },
    h2: "Who should use AVIF",
    body: [
      "AVIF comes from the AV1 video codec and compresses photos much better than JPG and also better than WebP. All current browsers display it, on the iPhone since iOS 16.",
      "The price is computing time. Encoding AVIF takes longer than JPG, a few seconds for large photos. Cloudflare Images does that work for you and sends the result straight back without storing it. The quality setting controls the trade-off. For photos on websites 60 to 70 is often enough, because AVIF shows fewer blocky artefacts than JPG at low quality.",
      "For email attachments or a print shop JPG is still the safe choice, since older programs can't open AVIF. For your own website or shop the switch pays off. Each image can be up to 20 MB.",
    ],
  },
  {
    slug: "wav-to-mp3",
    link: "WAV to MP3",
    title: "Convert WAV to MP3 without uploading · convert.",
    desc: "Turn WAV recordings into MP3 right in your browser. The file shrinks about seven times and never leaves your device.",
    h1: "Convert WAV to MP3.",
    lead: "One hour of WAV in CD quality takes about 630 MB. As MP3 it is around 85 MB, small enough to send.",
    example: { name: "interview.wav", to: "mp3", a: "412 MB", b: "55 MB", where: "local" },
    preset: { kind: "audio", target: "mp3", mode: "local" },
    h2: "What happens during the conversion",
    body: [
      "WAV stores sound uncompressed, exactly as the recorder delivers it. That is ideal for editing and archiving, and awkward for sending. MP3 leaves out the parts the ear barely notices and saves a lot of space that way.",
      "convert uses ffmpeg with the LAME encoder at variable bitrate level 2. That averages about 190 kbit/s and is more than enough for speech and music. The whole conversion runs in your browser. The first time, your browser downloads ffmpeg once, about 30 MB, and after that no further downloads are needed.",
      "Because nothing is uploaded, there is no fixed size limit. On a laptop, files up to about 1 GB work well. On a phone it gets tight from a few hundred MB. If the file is going on to editing or mastering, keep the WAV as the original.",
    ],
  },
];
