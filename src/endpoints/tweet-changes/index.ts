import newrelic from 'newrelic';
import { SNSEvent } from 'aws-lambda';
import Twitter from 'twitter-lite';
import { ChangeType, LocationOfInterestChange } from '../../types';

const rawHandler = async (event: SNSEvent) => {
  const message: LocationOfInterestChange = JSON.parse(
    event.Records[0].Sns.Message
  );
  console.log(JSON.stringify(message, undefined, 2));

  const twitter = new Twitter({
    consumer_key: process.env.TWITTER_CONSUMER_KEY ?? 'unconfigured',
    consumer_secret: process.env.TWITTER_CONSUMER_SECRET ?? 'unconfigured',
    access_token_key: process.env.TWITTER_ACCESS_TOKEN_KEY ?? 'unconfigured',
    access_token_secret:
      process.env.TWITTER_ACCESS_TOKEN_SECRET ?? 'unconfigured',
  });

  switch (message.changeType) {
    case ChangeType.ADDED:
    case ChangeType.REMOVED:
    case ChangeType.UPDATED:
      break;
    default:
      return;
  }
  const changeType =
    message.changeType === ChangeType.ADDED
      ? 'New'
      : message.changeType === ChangeType.UPDATED
      ? 'Updated'
      : 'Removed';
  let tweetText = `${changeType} ${message.group || 'Location of Interest'}

${message.location.location}

${message.location.day} ${message.location.times}

${
  message.changeType === ChangeType.REMOVED ? '' : message.location.instructions
}`;

  if (tweetText.length > 250) {
    tweetText = tweetText.substring(0, 250) + '\u{2026}';
  }

  tweetText = tweetText + `\n\n${process.env.LOI_PAGE_URL}`;

  await twitter.post('statuses/update', {
    status: tweetText,
  });
};

export const handler = newrelic.setLambdaHandler(rawHandler);
