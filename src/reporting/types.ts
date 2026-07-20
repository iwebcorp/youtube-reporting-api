export type AssetCategory = "Neighboring" | "Publishing" | "Unknown";

export type CsvRow = Record<string, string>;

export interface AssetMetadata {
  assetId: string;
  sourceCategory?: AssetCategory;
  title: string;
  customId: string;
  isrc: string;
  iswc: string;
  hfa: string;
  upc: string;
  writers: string;
  artist: string;
  album: string;
  label: string;
  assetType: string;
  musicClaimType: string;
  compositionRightType: string;
  channelId: string;
}

export interface ExtractionCliOptions {
  yearMonth?: string;
  reportDir?: string;
  outputDir?: string;
  neighboringDir?: string;
  publishingDir?: string;
  cacheFile?: string;
  systemManagedDir?: string;
  publishingSystemManagedDir?: string;
  sampleDir?: string;
  withClassification?: boolean;
}

export interface ExtractionConfig {
  yearMonth: string;
  reportDir: string;
  outputDir: string;
  neighboringDir: string;
  publishingDir: string;
  cacheFile: string;
  systemManagedDir: string;
  publishingSystemManagedDir: string;
  sampleDir: string;
}

export interface ReportFileGroup {
  reportDate: string;
  dateKey: string;
  revenueFiles: string[];
  usageFiles: string[];
}

export interface RevenueRecord {
  assetId: string;
  country: string;
  adjustmentType: string;
  partnerRevenue: number;
  subscriptionRevenue: number;
}

export interface UsageVideoRecord {
  videoId: string;
  views: number;
}

export interface UsageRecord {
  assetId: string;
  country: string;
  views: number;
  videos: UsageVideoRecord[];
}

export interface MergedDailyRecord {
  assetId: string;
  country: string;
  adjustmentType: string;
  partnerRevenue: number;
  subscriptionRevenue: number;
  views: number;
  videos: UsageVideoRecord[];
}

export interface MonthlySummaryEntry {
  assetId: string;
  country: string;
  month: string;
  revenue: number;
  views: number;
}

export interface NeighboringWriters {
  dailyAd: NodeJS.WritableStream;
  dailyAdAdjustment: NodeJS.WritableStream;
  monthlySubscription: NodeJS.WritableStream;
  financialDetail: NodeJS.WritableStream;
}

export interface PublishingWriters {
  dailyAd: NodeJS.WritableStream;
  dailyAdAdjustment: NodeJS.WritableStream;
  monthlySubscription: NodeJS.WritableStream;
  ddexDsr: NodeJS.WritableStream;
}

export interface NeighboringUsageCacheEntry {
  total: number;
  watchPage: number;
  embedded: number;
  channelPage: number;
  live: number;
  onDemand: number;
  adEnabled: number;
}

export interface PublishingUsageCacheEntry {
  totalRevenue: number;
  adRevenue: number;
  subRevenue: number;
  totalViews: number;
  watchPageViews: number;
  embeddedViews: number;
  channelPageViews: number;
  liveViews: number;
  onDemandViews: number;
  adEnabledViews: number;
  adsenseRevenue: number;
  doubleclickServedYouTubeSoldRevenue: number;
  doubleclickServedPartnerSoldRevenue: number;
  partnerServedPartnerSoldRevenue: number;
  partnerAdsenseRevenue: number;
  partnerDoubleclickServedYouTubeSoldRevenue: number;
  partnerDoubleclickServedPartnerSoldRevenue: number;
  partnerPartnerServedPartnerSoldRevenue: number;
}

export interface PublishingFinancialEntry {
  assetId: string;
  country: string;
  sourceTitle: string;
  sourceCustomId: string;
  sourceIsrc: string;
  sourceAssetType: string;
  ownedViews: number;
  adsenseRevenue: number;
  doubleclickServedYouTubeSoldRevenue: number;
  doubleclickServedPartnerSoldRevenue: number;
  partnerServedPartnerSoldRevenue: number;
  totalRevenue: number;
  partnerAdsenseRevenue: number;
  partnerDoubleclickServedYouTubeSoldRevenue: number;
  partnerDoubleclickServedPartnerSoldRevenue: number;
  partnerPartnerServedPartnerSoldRevenue: number;
  partnerTotalRevenue: number;
}

export interface RedSummaryEntry {
  assetId: string;
  country: string;
  adjustmentType: string;
  sourceTitle: string;
  sourceAssetType: string;
  sourceCustomId: string;
  sourceIsrc: string;
  sourceUpc: string;
  sourceGrid: string;
  sourceArtist: string;
  sourceAlbum: string;
  sourceLabel: string;
  ownedViews: number;
  monetizedViewsAudio: number;
  monetizedViewsAudioVisual: number;
  monetizedViews: number;
  youtubeRevenueSplit: number;
  partnerRevenueProRataAudio: number;
  partnerRevenueProRataAudioVisual: number;
  partnerRevenueProRata: number;
  partnerRevenuePerSubMin: number;
  partnerRevenue: number;
  offer: string;
  contentType: string;
  claimType: string;
}

export interface AudioTierDetailEntry {
  assetId: string;
  country: string;
  date: string;
  videoId: string;
  title: string;
  customId: string;
  isrc: string;
  upc: string;
  grid: string;
  artist: string;
  album: string;
  label: string;
  ownedViews: number;
  youtubeRevenueSplit: number;
  partnerRevenueProRata: number;
  partnerRevenuePerPlayMin: number;
  partnerRevenue: number;
}
