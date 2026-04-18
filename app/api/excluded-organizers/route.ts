import { NextRequest, NextResponse } from 'next/server';
import {
  addExcludedOrganizer,
  getExcludedOrganizers,
  isMissingExcludedOrganizersTableError,
  normalizeOrganizerName,
  removeExcludedOrganizer,
} from '@/lib/db';

export const dynamic = 'force-dynamic';

const TABLE_MISSING_MESSAGE =
  'excluded_organizers テーブルが未作成です。Supabase に supabase/schema.sql を適用すると、主催者の手動除外が使えるようになります。';

function parseOrganizerName(value: unknown): string {
  return typeof value === 'string' ? normalizeOrganizerName(value) : '';
}

function tableMissingResponse(status: number) {
  return NextResponse.json(
    {
      organizer: '',
      ready: false,
      error: TABLE_MISSING_MESSAGE,
    },
    { status },
  );
}

export async function GET() {
  try {
    const organizers = await getExcludedOrganizers();

    return NextResponse.json({
      organizers,
      total: organizers.length,
      ready: true,
    });
  } catch (error) {
    if (isMissingExcludedOrganizersTableError(error)) {
      return NextResponse.json(
        {
          organizers: [],
          total: 0,
          ready: false,
          error: TABLE_MISSING_MESSAGE,
        },
        { status: 200 },
      );
    }

    console.error('[GET /api/excluded-organizers] error:', error);
    return NextResponse.json(
      {
        organizers: [],
        total: 0,
        ready: false,
        error: 'Internal server error',
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const organizerName = parseOrganizerName(body?.organizer_name);

    if (!organizerName) {
      return NextResponse.json(
        {
          organizer: '',
          ready: false,
          error: 'organizer_name is required.',
        },
        { status: 400 },
      );
    }

    await addExcludedOrganizer(organizerName);

    return NextResponse.json({
      organizer: organizerName,
      ready: true,
    });
  } catch (error) {
    if (isMissingExcludedOrganizersTableError(error)) {
      return tableMissingResponse(503);
    }

    console.error('[POST /api/excluded-organizers] error:', error);
    return NextResponse.json(
      {
        organizer: '',
        ready: false,
        error: 'Internal server error',
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const organizerName = parseOrganizerName(body?.organizer_name);

    if (!organizerName) {
      return NextResponse.json(
        {
          organizer: '',
          ready: false,
          error: 'organizer_name is required.',
        },
        { status: 400 },
      );
    }

    await removeExcludedOrganizer(organizerName);

    return NextResponse.json({
      organizer: organizerName,
      ready: true,
    });
  } catch (error) {
    if (isMissingExcludedOrganizersTableError(error)) {
      return tableMissingResponse(503);
    }

    console.error('[DELETE /api/excluded-organizers] error:', error);
    return NextResponse.json(
      {
        organizer: '',
        ready: false,
        error: 'Internal server error',
      },
      { status: 500 },
    );
  }
}
