import { Router } from 'express';
import faunadb from 'faunadb';
import { string, object } from 'yup';
import generateRandomSlug from '../generateRandomSlug';
import jwtCheck from '../jwtCheck';

const router = Router();
const faunaClient = new faunadb.Client({
  secret: process.env.FAUNA_SECRET_KEY ?? ''
});
const q = faunadb.query;

// return 100 most popular urls for leaderboard
router.get('/', async (_req, _res, _next) => {
  try {
    const query: any = await faunaClient.query(
      q.Paginate(q.Match(q.Index('top_aliases_by_clicks')))
    );
    const result = query.data.map((item: any) => {
      return {
        clicks: item[0],
        alias: item[1]
      };
    });
    _res.json(result);
  } catch (error) {
    _res.json(error);
  }
});

const schema = object().shape({
  owner: string().trim().nullable(),
  url: string().trim().url().required().nullable(),
  alias: string().trim().matches(/[\w-]/i).nullable().min(3).max(20)
});
// create a new shortened url
router.post(
  '/',
  jwtCheck({ credentialsRequired: false }),
  async (req, res, _next) => {
    const { owner, url, alias } = req.body;

    try {
      await schema.validate({ owner, url, alias });
    } catch (error) {
      console.log(error);
      return res.status(400).json({ error: 'invalid data' });
    }

    // TODO auto generate sdk from fauna so we don't have to do "any"
    const { data }: any = await faunaClient.query(
      q.Create(q.Collection('snails'), {
        data: {
          url,
          owner: owner ?? '',
          alias: alias ?? (await generateRandomSlug()),
          clicks: 0
        }
      })
    );

    res.json(data);
  }
);

// get the url for a given alias
router.get('/:alias', async (req, res, _next) => {
  const alias = req.params.alias;
  const doc: any = await faunaClient.query(
    q.Get(q.Match(q.Index('aliases'), alias))
  );

  await faunaClient.query(
    q.Update(q.Ref(doc.ref), { data: { clicks: doc.data.clicks + 1 } })
  );

  res.json(doc.data);
});

// destroy a shortened url
router.delete('/:alias', jwtCheck(), async (req: any, res, _next) => {
  const alias = req.params.alias;
  const doc: any = await faunaClient.query(
    q.Get(q.Match(q.Index('aliases'), alias))
  );

  if (doc.data.owner === req.user.sub) {
    await faunaClient.query(q.Delete(q.Ref(doc.ref)));

    res.json({ success: true });
  } else {
    res.status(403).json({ success: false, error: 'not authorized' });
  }
});

export default router;
