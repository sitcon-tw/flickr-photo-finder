export let pageSize = 96;
export let searchDebounceMs = 180;
export let resultTrackingDelayMs = 600;
export let discoverWindowSize = 24;
export let discoverHistorySize = 12;

export let peopleCountFilters = [
  { label: "全部人數", value: "" },
  { label: "未標記", value: "unknown" },
  { label: "無人", value: "0" },
  { label: "1 人", value: "1" },
  { label: "2-5 人", value: "2-5" },
  { label: "6-20 人", value: "6-20" },
  { label: "21 人以上", value: "21+" },
];

export let taskModes = [
  {
    id: "all",
    label: "全部照片",
    description: "不套任務權重",
  },
  {
    id: "social",
    label: "社群貼文",
    description: "友善、交流、可裁切",
    recommendedUses: ["社群貼文", "社群介紹", "活動回顧"],
    moods: ["友善", "交流感", "青春感", "活力", "熱鬧"],
    scenes: ["會眾", "交流", "工作人員"],
    safeCrops: ["1:1", "16:9", "9:16"],
    prefersNegativeSpace: true,
  },
  {
    id: "hero",
    label: "網站橫幅",
    description: "橫式、留白、可放標題",
    recommendedUses: ["網站橫幅", "社群介紹"],
    moods: ["專業", "青春感", "友善"],
    scenes: ["舞台", "會眾", "交流", "場地", "背板"],
    orientations: ["landscape"],
    safeCrops: ["16:9"],
    prefersNegativeSpace: true,
  },
  {
    id: "visual",
    label: "設計素材",
    description: "版面背景、簡報與延伸素材",
    recommendedUses: ["網站橫幅", "社群貼文", "簡報"],
    moods: ["專業", "青春感", "活力", "安靜"],
    scenes: ["場地", "背板", "舞台", "交流"],
    orientations: ["landscape", "square"],
    safeCrops: ["16:9", "1:1", "9:16"],
    prefersNegativeSpace: true,
  },
  {
    id: "sponsor-pitch",
    label: "贊助提案",
    description: "互動、觸及、品牌價值",
    recommendedUses: ["贊助提案", "簡報"],
    moods: ["熱鬧", "專業", "交流感"],
    scenes: ["攤位", "會眾", "交流", "舞台"],
    sponsorshipTags: ["品牌露出", "會眾互動", "觸及學生族群", "社群信任感", "參與者體驗"],
  },
  {
    id: "sponsor-report",
    label: "贊助成果",
    description: "品項與成果佐證",
    recommendedUses: ["贊助成果報告"],
    scenes: ["攤位", "會眾", "背板", "舞台", "螢幕"],
    sponsorshipTags: ["贊助成果佐證", "品牌露出", "會眾互動", "主舞台曝光", "議程曝光"],
  },
  {
    id: "press",
    label: "新聞稿/簡報",
    description: "正式、代表性、可追溯",
    recommendedUses: ["新聞稿", "簡報", "社群介紹", "活動回顧"],
    moods: ["專業", "專注", "儀式感", "交流感"],
    scenes: ["舞台", "講者", "會眾", "背板", "場地"],
    orientations: ["landscape"],
  },
  {
    id: "volunteer",
    label: "志工招募",
    description: "幕後、活力、參與感",
    recommendedUses: ["志工招募"],
    moods: ["幕後感", "友善", "青春感", "活力"],
    scenes: ["工作人員", "交流", "報到", "攝影"],
  },
  {
    id: "recap",
    label: "活動回顧",
    description: "規模、交流、成果",
    recommendedUses: ["活動回顧", "社群介紹"],
    moods: ["熱鬧", "成就感", "交流感", "儀式感"],
    scenes: ["會眾", "舞台", "合照", "交流", "講者"],
  },
];

export function applyTaskModeRegistry(interfaceRegistry) {
  const settings = interfaceRegistry?.pages?.settings ?? {};
  pageSize = Number(settings.pageSize || pageSize);
  searchDebounceMs = Number(settings.searchDebounceMs || searchDebounceMs);
  resultTrackingDelayMs = Number(settings.resultTrackingDelayMs || resultTrackingDelayMs);
  discoverWindowSize = Number(settings.discoverWindowSize || discoverWindowSize);
  discoverHistorySize = Number(settings.discoverHistorySize || discoverHistorySize);
  peopleCountFilters = interfaceRegistry?.pages?.peopleCountBuckets ?? peopleCountFilters;
  taskModes = interfaceRegistry?.pages?.taskModes ?? taskModes;
}
