import { getSignedUrl } from "@aws-sdk/cloudfront-signer";

const cloudfrontDistributionDomain = process.env.CLOUDFRONT_URL;
const privateKey = process.env.CLOUDFRONT_PRIVATE_KEY.replace(/\\n/g, "\n");
const keyPairId = process.env.CLOUDFRONT_PUBLIC_KEY_ID;

export const getCloudFrontSignedUrl = ({ s3ObjectKey, filename, download }) => {
  let url = `${cloudfrontDistributionDomain}/${s3ObjectKey}`;

  if (download && filename) {
    const disposition = encodeURIComponent(`attachment; filename="${filename}"`);
    url += `?response-content-disposition=${disposition}`;
  }

  // URL expires in 5 minutes for maximum security
  const dateLessThan = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  return getSignedUrl({
    url,
    keyPairId,
    dateLessThan,
    privateKey,
  });
};
