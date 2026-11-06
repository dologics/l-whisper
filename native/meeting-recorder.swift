// meeting-recorder: records your microphone + everything the Mac plays (system audio)
// and writes it as raw stereo audio to stdout:  left = mic (you), right = system (others).
//
//   stdout: interleaved signed 16-bit little-endian PCM, 2 channels, always 48 000 Hz
//   stderr: status lines →  ready rate=48000 | mic name=<device> | level mic=<dB> sys=<dB> | error: … | stopped
//   stdin:  close it (or send "stop") to stop cleanly.
//
// System audio uses a Core Audio *process tap* (macOS 14.2+): a private read-only copy of
// everything the Mac plays — any app, any output device. No virtual driver, no Screen Recording.
//
// Which mic? The one your CALL is using: an input device another app (WhatsApp, Chrome/Meet,
// Zoom…) already has open; otherwise macOS's default input. A watchdog re-checks every 2 s and
// switches if the call moves to another mic or the current one is unplugged. Mic + tap run
// together in a private *aggregate device* (kept in sync); every rate is resampled to 48 kHz.
//
// Build: swiftc -O native/meeting-recorder.swift -o bin/meeting-recorder
import AudioToolbox
import CoreAudio
import Foundation

setvbuf(stderr, nil, _IOLBF, 0)
func status(_ line: String) { FileHandle.standardError.write((line + "\n").data(using: .utf8)!) }
func fail(_ message: String) -> Never { status("error: \(message)"); exit(1) }

let OUTPUT_RATE: Double = 48000

// ---------- small Core Audio helpers ----------
func address(_ selector: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
}

func readUInt32(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> UInt32? {
    var addr = address(selector)
    var value: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.size)
    return AudioObjectGetPropertyData(object, &addr, 0, nil, &size, &value) == noErr ? value : nil
}

func readFloat64(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> Float64? {
    var addr = address(selector)
    var value: Float64 = 0
    var size = UInt32(MemoryLayout<Float64>.size)
    return AudioObjectGetPropertyData(object, &addr, 0, nil, &size, &value) == noErr ? value : nil
}

func readString(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
    var addr = address(selector)
    var value: Unmanaged<CFString>?
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    guard AudioObjectGetPropertyData(object, &addr, 0, nil, &size, &value) == noErr, let v = value else { return nil }
    return v.takeRetainedValue() as String
}

func inputChannelCount(_ device: AudioObjectID) -> Int {
    var addr = address(kAudioDevicePropertyStreamConfiguration, kAudioObjectPropertyScopeInput)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(device, &addr, 0, nil, &size) == noErr, size > 0 else { return 0 }
    let raw = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: 16)
    defer { raw.deallocate() }
    guard AudioObjectGetPropertyData(device, &addr, 0, nil, &size, raw) == noErr else { return 0 }
    return UnsafeMutableAudioBufferListPointer(raw.assumingMemoryBound(to: AudioBufferList.self))
        .reduce(0) { $0 + Int($1.mNumberChannels) }
}

func defaultInput() -> AudioObjectID? {
    let id = readUInt32(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultInputDevice) ?? 0
    return id == 0 ? nil : id
}

func deviceName(_ id: AudioObjectID) -> String { readString(id, kAudioObjectPropertyName) ?? "microphone" }
func isAlive(_ id: AudioObjectID) -> Bool { readUInt32(id, kAudioDevicePropertyDeviceIsAlive) == 1 }
func isInUse(_ id: AudioObjectID) -> Bool { readUInt32(id, kAudioDevicePropertyDeviceIsRunningSomewhere) == 1 }

/// Real microphones: have input channels; not aggregate (e.g. ours) and not virtual (e.g. Camo).
func realMicrophones() -> [AudioObjectID] {
    var addr = address(kAudioHardwarePropertyDevices)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size) == noErr else { return [] }
    var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids) == noErr else { return [] }
    return ids.filter { id in
        let transport = readUInt32(id, kAudioDevicePropertyTransportType) ?? 0
        return inputChannelCount(id) > 0
            && transport != kAudioDeviceTransportTypeAggregate
            && transport != kAudioDeviceTransportTypeVirtual
    }
}

/// The mic to record: one another app (the call) is using, else the default input.
func chooseMic(excluding current: AudioObjectID? = nil) -> AudioObjectID? {
    let inUse = realMicrophones().filter { $0 != current && isInUse($0) }
    if let d = defaultInput(), inUse.contains(d) { return d } // the call uses the default → best case
    return inUse.first ?? defaultInput()
}

// ---------- the system-audio tap (created once, reused across mic switches) ----------
let tapDescription = CATapDescription(stereoGlobalTapButExcludeProcesses: []) // everything the Mac plays
tapDescription.uuid = UUID()
tapDescription.isPrivate = true
tapDescription.muteBehavior = .unmuted // you still hear the meeting normally
var tapID = AudioObjectID(kAudioObjectUnknown)
guard AudioHardwareCreateProcessTap(tapDescription, &tapID) == noErr else {
    fail("could not create the system audio tap (permission for recording system audio?)")
}

// ---------- audio processing: float buffers → resample to 48 kHz → int16 stereo ----------
let writer = DispatchQueue(label: "stdout-writer") // never block the audio thread on the pipe
var micSumSq = 0.0, sysSumSq = 0.0, levelFrames = 0
var inputRate: Double = OUTPUT_RATE
// linear resampler state: position inside the current chunk (-1 = the previous chunk's last frame)
var resamplePos: Double = 0
var prevMic: Float = 0, prevSys: Float = 0

func toInt16(_ v: Float) -> Int16 { Int16(max(-1, min(1, v)) * 32767) }
func dB(_ sumSq: Double, _ n: Int) -> String {
    let rms = n > 0 ? (sumSq / Double(n)).squareRoot() : 0
    return rms > 0 ? String(format: "%.0f", 20 * log10(rms)) : "-inf"
}

/// One audio cycle: mic channels (first buffers) + tap channels (last buffer).
func process(_ inputData: UnsafePointer<AudioBufferList>) {
    let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inputData))
    guard buffers.count > 0 else { return }
    let micBuffers = buffers.count > 1 ? Array(buffers.dropLast()) : []
    let sysBuffer = buffers[buffers.count - 1]
    let sysCh = max(1, Int(sysBuffer.mNumberChannels))
    let frames = Int(sysBuffer.mDataByteSize) / (4 * sysCh)
    guard frames > 0, let sysData = sysBuffer.mData?.assumingMemoryBound(to: Float.self) else { return }

    // 1) mono mic + mono system for each input frame
    var mic = [Float](repeating: 0, count: frames)
    var sys = [Float](repeating: 0, count: frames)
    for f in 0..<frames {
        var m: Float = 0, n = 0
        for b in micBuffers {
            let ch = max(1, Int(b.mNumberChannels))
            guard let d = b.mData?.assumingMemoryBound(to: Float.self), f < Int(b.mDataByteSize) / (4 * ch) else { continue }
            for c in 0..<ch { m += d[f * ch + c]; n += 1 }
        }
        mic[f] = n > 0 ? m / Float(n) : 0
        var s: Float = 0
        for c in 0..<sysCh { s += sysData[f * sysCh + c] }
        sys[f] = s / Float(sysCh)
        micSumSq += Double(mic[f] * mic[f]); sysSumSq += Double(sys[f] * sys[f])
    }
    levelFrames += frames
    if Double(levelFrames) >= inputRate { // once a second
        status("level mic=\(dB(micSumSq, levelFrames)) sys=\(dB(sysSumSq, levelFrames))")
        micSumSq = 0; sysSumSq = 0; levelFrames = 0
    }

    // 2) resample to 48 kHz (linear interpolation — fine for speech), interleave, int16
    var out = [Int16]()
    let step = inputRate / OUTPUT_RATE
    if step == 1 {
        out.reserveCapacity(frames * 2)
        for f in 0..<frames { out.append(toInt16(mic[f])); out.append(toInt16(sys[f])) }
    } else {
        out.reserveCapacity(Int(Double(frames) / step + 2) * 2)
        var t = resamplePos
        while t < Double(frames - 1) { // strictly before the last frame: it's interpolated with the next chunk
            let i = Int(floor(t)), frac = Float(t - floor(t))
            let m0 = i < 0 ? prevMic : mic[i], s0 = i < 0 ? prevSys : sys[i]
            let m1 = mic[i + 1], s1 = sys[i + 1]
            out.append(toInt16(m0 + (m1 - m0) * frac))
            out.append(toInt16(s0 + (s1 - s0) * frac))
            t += step
        }
        resamplePos = t - Double(frames)
        prevMic = mic[frames - 1]; prevSys = sys[frames - 1]
    }
    let data = out.withUnsafeBufferPointer { Data(buffer: $0) }
    writer.async { FileHandle.standardOutput.write(data) }
}

// ---------- a capture session = aggregate(mic + tap) + IO callback ----------
var currentMic: AudioObjectID = 0
var aggregateID = AudioObjectID(kAudioObjectUnknown)
var procID: AudioDeviceIOProcID?
let ioQueue = DispatchQueue(label: "meeting-audio", qos: .userInteractive)

func startSession(mic: AudioObjectID) -> Bool {
    guard let micUID = readString(mic, kAudioDevicePropertyDeviceUID) else { return false }
    let description: [String: Any] = [
        kAudioAggregateDeviceNameKey: "L - Whisper Meeting",
        kAudioAggregateDeviceUIDKey: "local.whisper-desktop.meeting." + UUID().uuidString,
        kAudioAggregateDeviceIsPrivateKey: true, // invisible to other apps, removed when we exit
        kAudioAggregateDeviceIsStackedKey: false,
        kAudioAggregateDeviceMainSubDeviceKey: micUID, // the mic's clock drives the device
        kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: micUID]],
        kAudioAggregateDeviceTapListKey: [[kAudioSubTapUIDKey: tapDescription.uuid.uuidString,
                                           kAudioSubTapDriftCompensationKey: true]],
        kAudioAggregateDeviceTapAutoStartKey: true,
    ]
    var agg = AudioObjectID(kAudioObjectUnknown)
    guard AudioHardwareCreateAggregateDevice(description as CFDictionary, &agg) == noErr else { return false }
    var proc: AudioDeviceIOProcID?
    let err = AudioDeviceCreateIOProcIDWithBlock(&proc, agg, ioQueue) { _, inputData, _, _, _ in process(inputData) }
    guard err == noErr, let p = proc else { AudioHardwareDestroyAggregateDevice(agg); return false }

    ioQueue.sync { // reset per-session audio state on the audio queue
        inputRate = readFloat64(agg, kAudioDevicePropertyNominalSampleRate) ?? OUTPUT_RATE
        resamplePos = 0; prevMic = 0; prevSys = 0
        micSumSq = 0; sysSumSq = 0; levelFrames = 0
    }
    guard AudioDeviceStart(agg, p) == noErr else {
        AudioDeviceDestroyIOProcID(agg, p); AudioHardwareDestroyAggregateDevice(agg); return false
    }
    aggregateID = agg; procID = p; currentMic = mic
    status("mic name=\(deviceName(mic)) rate=\(Int(inputRate))")
    return true
}

func stopSession() {
    guard let p = procID else { return }
    AudioDeviceStop(aggregateID, p)
    AudioDeviceDestroyIOProcID(aggregateID, p)
    AudioHardwareDestroyAggregateDevice(aggregateID)
    procID = nil; aggregateID = AudioObjectID(kAudioObjectUnknown)
}

// ---------- start ----------
guard let firstMic = chooseMic(), startSession(mic: firstMic) else {
    AudioHardwareDestroyProcessTap(tapID)
    fail("no microphone could be opened")
}
status("ready rate=\(Int(OUTPUT_RATE))")

// ---------- watchdog: follow the call's mic, survive unplugging ----------
var candidate: AudioObjectID = 0, candidateChecks = 0
let watchdog = DispatchSource.makeTimerSource(queue: .main)
watchdog.schedule(deadline: .now() + 2, repeating: 2)
watchdog.setEventHandler {
    // current mic gone (unplugged)? → switch right away
    if !isAlive(currentMic) || !realMicrophones().contains(currentMic) {
        stopSession()
        if let next = chooseMic(), startSession(mic: next) { return }
        status("error: no microphone left"); return
    }
    // another app (the call) started using a different mic for ≥ 4 s → follow it
    let other = realMicrophones().first { $0 != currentMic && isInUse($0) } ?? 0
    if other != 0 && other == candidate { candidateChecks += 1 } else { candidate = other; candidateChecks = other == 0 ? 0 : 1 }
    if candidate != 0 && candidateChecks >= 2 {
        let next = candidate
        candidate = 0; candidateChecks = 0
        stopSession()
        if !startSession(mic: next), let fallback = defaultInput() { _ = startSession(mic: fallback) }
    }
}
watchdog.resume()

func stopAndExit() {
    watchdog.cancel()
    stopSession()
    AudioHardwareDestroyProcessTap(tapID)
    writer.sync {} // flush pending audio to stdout
    status("stopped")
    exit(0)
}

// Stop when the app closes our stdin (or sends "stop"), or on SIGTERM / SIGINT.
Thread.detachNewThread {
    while let line = readLine() { if line.trimmingCharacters(in: .whitespaces) == "stop" { break } }
    DispatchQueue.main.async { stopAndExit() }
}
signal(SIGTERM, SIG_IGN); signal(SIGINT, SIG_IGN); signal(SIGPIPE, SIG_IGN)
let signalSources = [SIGTERM, SIGINT].map { sig -> DispatchSourceSignal in
    let s = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    s.setEventHandler { stopAndExit() }
    s.resume()
    return s
}
dispatchMain()
