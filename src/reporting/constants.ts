export const REPORT_TYPES = {
  revenue: "content_owner_asset_estimated_revenue_a1",
  usage: "content_owner_asset_combined_a3",
} as const;

export const DEFAULT_DIRECTORIES = {
  neighboring: "인접",
  publishing: "저작",
} as const;

export const UNKNOWN_TEXT_VALUES = new Set(["", "unknown", "none", "null", "undefined", "n/a", "na"]);

export const NEIGHBORING_HEADERS = {
  dailyAd:
    "Adjustment Type,Day,Country,Asset ID,Asset Title,Asset Labels,Asset Channel ID,Asset Type,Custom ID,ISRC,UPC,GRid,Artist,Album,Label,Administer Publish Rights,Owned Views,YouTube Revenue Split : Auction,YouTube Revenue Split : Reserved,YouTube Revenue Split : Partner Sold YouTube Served,YouTube Revenue Split : Partner Sold Partner Served,YouTube Revenue Split,Partner Revenue : Auction,Partner Revenue : Reserved,Partner Revenue : Partner Sold YouTube Served,Partner Revenue : Partner Sold Partner Served,Partner Revenue\n",
  monthlySubscription:
    "Asset Summary\nAdjustment Type,Month,Country,Asset ID,Asset Title,Asset Labels,Asset Type,Custom ID,ISRC,UPC,GRID,Artist,Album,Label,Claim Type,Content Type,Offer,Owned Views,Monetized Views : Audio,Monetized Views : Audio Visual,Monetized Views,YouTube Revenue Split,Partner Revenue : Pro Rata : Audio,Partner Revenue : Pro Rata : Audio Visual,Partner Revenue : Pro Rata,Partner Revenue : Per Sub Min,Partner Revenue\n",
  financialDetail:
    "Adjustment Type,Date,Country,Video ID,Asset ID,Asset Title,Asset Labels,Custom ID,ISRC,Upc,Grid,Artist,Album,Label,Owned Views,YouTube Revenue Split,Partner Revenue Pro Rata,Partner Revenue Per Play Min,Partner Revenue\n",
} as const;

export const PUBLISHING_HEADERS = {
  dailyAd:
    "Asset ID,Asset Labels,Custom ID,ISWC,HFA Song Code,Asset Title,Writers,Music Claim Type,Composition Right Type,Ownership Percentage,Country,Owned Views,Owned Views : Watch Page,Owned Views : Embedded Player,Owned Views : Channel Page,Owned Views : Live,Owned Views : On Demand,Owned Views : Ad-Enabled,YouTube Revenue Split : AdSense Served YouTube Sold,YouTube Revenue Split : DoubleClick Served YouTube Sold,YouTube Revenue Split : DoubleClick Served Partner Sold,YouTube Revenue Split : Partner Served Partner Sold,YouTube Revenue Split,Partner Revenue : AdSense Served YouTube Sold,Partner Revenue : DoubleClick Served YouTube Sold,Partner Revenue : DoubleClick Served Partner Sold,Partner Revenue : Partner Served Partner Sold,Partner Revenue\n",
  dailyAdAdjustment:
    "Adjustment Type,Day,Country,Asset ID,Asset Title,Asset Labels,Asset Channel ID,Asset Type,Custom ID,ISRC,ISWC,HFA Song Code,Writers,Owned Views,YouTube Revenue Split : Auction,YouTube Revenue Split : Reserved,YouTube Revenue Split : Partner Sold YouTube Served,YouTube Revenue Split : Partner Sold Partner Served,YouTube Revenue Split,Partner Revenue : Auction,Partner Revenue : Reserved,Partner Revenue : Partner Sold YouTube Served,Partner Revenue : Partner Sold Partner Served,Partner Revenue\n",
  monthlySubscription:
    "Asset Summary\nAdjustment Type,Month,Country,Asset ID,Asset Title,Asset Labels,Custom ID,ISRC,ISWC,HFA Song Code,Writers,Composition Right Type,Ownership Percentage,Claim Quality,Revshare Rate Type,Offer,Owned Views,Monetized Views : Audio,Monetized Views : Audio Visual,Monetized Views,YouTube Revenue Split,Partner Revenue : Pro Rata : Audio,Partner Revenue : Pro Rata : Audio Visual,Partner Revenue : Pro Rata,Partner Revenue : Per Sub Min,Partner Revenue\n",
} as const;

export const METADATA_FALLBACKS = {
  title: "Untitled Asset",
  customId: "",
  isrc: "",
  iswc: "",
  hfa: "",
  upc: "",
  writers: "Unidentified Writers",
  artist: "Various Artists",
  album: "Unknown Album",
  label: "Unknown Label",
  assetType: "Sound Recording",
  musicClaimType: "Music Video",
  compositionRightType: "Mechanical; Performing",
  channelId: "",
} as const;
